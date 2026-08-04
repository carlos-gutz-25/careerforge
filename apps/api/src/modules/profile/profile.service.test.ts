// Import-service integration tests for the M1-08 criteria leg paths the HTTP
// route deliberately cannot reach (--force) or cannot observe (all-or-
// nothing rollback). Directories: docs/profile.example/ (fictional) or a
// temp copy of it — never the real docs/profile/ (RISKS P-01).
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createProfileFactsRepository,
  createProfileRepository,
  createSearchCriteriaRepository,
} from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { EXAMPLE_PROFILE_DIR } from './fixture-dirs.ts';
import { ProfileParseError } from './parse-errors.ts';
import {
  createProfileImportService,
  ImportConfirmationError,
  PROFILE_FACTS_FILE,
  PROFILE_SOURCE_FILES,
  SnapshotUnavailableError,
} from './profile.service.ts';

const handle = createTestDb();
const profile = createProfileRepository(handle.db);
const facts = createProfileFactsRepository(handle.db);
const criteria = createSearchCriteriaRepository(handle.db);

const buildService = (profileDir: string) =>
  createProfileImportService({ profileDir, profile, facts, criteria });

async function insertUser(): Promise<string> {
  const result = await handle.pool.query<{ id: string }>(
    `insert into users (email, password_hash)
     values ('alex.rivera.example@example.com', 'fake-hash') returning id`,
  );
  return result.rows[0]!.id;
}

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

describe('profile import service — criteria leg (M1-08)', () => {
  it('--force replaces a divergent criteria row (the CLI-only overwrite path)', async () => {
    const userId = await insertUser();
    const service = buildService(EXAMPLE_PROFILE_DIR);

    const first = await service.importProfile(userId);
    expect(first.criteria.outcome).toBe('created');

    const imported = await criteria.get(userId);
    await criteria.upsert(userId, {
      hardFilters: imported!.hardFilters,
      positiveSignals: imported!.positiveSignals,
      negativeSignals: ['agency_body_shop'],
      forceLowestPriority: imported!.forceLowestPriority,
      compBounds: imported!.compBounds,
    });

    // Without force: refused. With force: replaced, row mirrors the source.
    const refused = await service.importProfile(userId);
    expect(refused.criteria.outcome).toBe('skipped_existing');
    const forced = await service.importProfile(userId, { forceCriteria: true });
    expect(forced.criteria.outcome).toBe('replaced');
    const after = await criteria.get(userId);
    expect(after!.negativeSignals).toEqual(imported!.negativeSignals);
  });

  it('a broken job-criteria.md blocks the profile tables too — all-or-nothing, nothing written', async () => {
    const userId = await insertUser();
    // A temp profile dir: the example's valid profile sources + a criteria
    // file MISSING its comp_bounds block (all five are required).
    const dir = await mkdtemp(path.join(tmpdir(), 'm108-broken-criteria-'));
    for (const name of [
      PROFILE_SOURCE_FILES.resume,
      PROFILE_SOURCE_FILES.skills,
      PROFILE_SOURCE_FILES.projects,
    ]) {
      await copyFile(path.join(EXAMPLE_PROFILE_DIR, name), path.join(dir, name));
    }
    await writeFile(
      path.join(dir, PROFILE_SOURCE_FILES.criteria),
      [
        '```yaml',
        'exclude_when:',
        '  - seniority:',
        '      - entry_level',
        '```',
        '```yaml',
        'increase_score_for:',
        '  role:',
        '    - senior_software_engineer',
        '  technologies:',
        '    - typescript',
        '  problem_domains:',
        '    - api_platforms',
        '  work_arrangement:',
        '    - remote_us',
        '  scope:',
        '    - architecture',
        '```',
        '```yaml',
        'decrease_score_for:',
        '  - frontend_only',
        '```',
        '```yaml',
        'force_lowest_priority: []',
        '```',
        '',
      ].join('\n'),
      'utf8',
    );

    const service = buildService(dir);
    await expect(service.importProfile(userId)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProfileParseError &&
        error.issues.some(
          (issue) =>
            issue.file === 'job-criteria.md' &&
            issue.rule === 'missing-section' &&
            issue.field === 'comp_bounds',
        ),
    );

    // Valid profile sources were NOT synced past the criteria failure.
    const { rows } = await handle.pool.query<{ count: string }>(
      `select count(*) from profile_skills where user_id = $1`,
      [userId],
    );
    expect(rows[0]!.count).toBe('0');
    expect(await criteria.get(userId)).toBeUndefined();
  });
});

describe('profile import service — M6-01 resume-header rules', () => {
  it('a new resume defect (unparseable education period) blocks the whole import, nothing written', async () => {
    const userId = await insertUser();
    // The example sources, but the resume's education period is mutated to an
    // unparseable value — the sole defect, so the M6-01 rule is what rejects.
    const dir = await mkdtemp(path.join(tmpdir(), 'm601-bad-education-'));
    for (const name of [
      PROFILE_SOURCE_FILES.skills,
      PROFILE_SOURCE_FILES.projects,
      PROFILE_SOURCE_FILES.criteria,
    ]) {
      await copyFile(path.join(EXAMPLE_PROFILE_DIR, name), path.join(dir, name));
    }
    const resume = (await readFile(path.join(EXAMPLE_PROFILE_DIR, 'resume.md'), 'utf8')).replace(
      '*2008 - 2012*',
      '*sometime in the 2000s*',
    );
    await writeFile(path.join(dir, PROFILE_SOURCE_FILES.resume), resume, 'utf8');

    const service = buildService(dir);
    await expect(service.importProfile(userId)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProfileParseError &&
        error.issues.some(
          (issue) => issue.file === 'resume.md' && issue.rule === 'education-period-unparseable',
        ),
    );

    // All-or-nothing: the new tables (and everything else) stay empty.
    const { rows } = await handle.pool.query<{ count: string }>(
      `select
         (select count(*) from profile_contact where user_id = $1) as contact,
         (select count(*) from profile_skills where user_id = $1) as skills`,
      [userId],
    );
    expect(rows[0]).toEqual({ contact: '0', skills: '0' });
  });
});

describe('profile import service — durable facts (M12-03)', () => {
  const copyRequired = async (dir: string) => {
    for (const name of [
      PROFILE_SOURCE_FILES.resume,
      PROFILE_SOURCE_FILES.skills,
      PROFILE_SOURCE_FILES.projects,
      PROFILE_SOURCE_FILES.criteria,
    ]) {
      await copyFile(path.join(EXAMPLE_PROFILE_DIR, name), path.join(dir, name));
    }
  };

  const factsBody = (withRelocation: boolean) =>
    [
      '```yaml',
      'facts:',
      '  work_authorization:',
      '    value: "Authorized to work in the US"',
      '    declared: 2026-01-15',
      ...(withRelocation
        ? [
            '  relocation_stance:',
            '    value: open_for_right_opportunity',
            '    declared: 2026-01-15',
          ]
        : []),
      '```',
      '',
    ].join('\n');

  it('imports facts.md, is idempotent on re-import, and full-syncs deletes (D-4)', async () => {
    const userId = await insertUser();
    const dir = await mkdtemp(path.join(tmpdir(), 'm1203-facts-'));
    await copyRequired(dir);
    const service = buildService(dir);

    // First import: two facts inserted.
    await writeFile(path.join(dir, 'facts.md'), factsBody(true), 'utf8');
    const first = await service.importProfile(userId);
    expect(first.facts).toEqual({ inserted: 2, updated: 0, deleted: 0 });
    expect(await facts.listFacts(userId)).toHaveLength(2);

    // Re-import unchanged: idempotent (all zero).
    const second = await service.importProfile(userId);
    expect(second.facts).toEqual({ inserted: 0, updated: 0, deleted: 0 });

    // Drop the relocation fact from the file: the full-sync deletes the row.
    await writeFile(path.join(dir, 'facts.md'), factsBody(false), 'utf8');
    const third = await service.importProfile(userId);
    expect(third.facts).toEqual({ inserted: 0, updated: 0, deleted: 1 });
    const remaining = await facts.listFacts(userId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.kind).toBe('work_authorization');
  });

  it('a profile with NO facts.md imports cleanly (facts.md is optional)', async () => {
    const userId = await insertUser();
    const dir = await mkdtemp(path.join(tmpdir(), 'm1203-nofacts-'));
    await copyRequired(dir);
    const summary = await buildService(dir).importProfile(userId);
    expect(summary.facts).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    expect(await facts.listFacts(userId)).toHaveLength(0);
  });
});

// M13-09 (F-7): the import deletion guard. previewImport reports the would-be
// deletes + a CAS fingerprint without writing; importGuarded refuses a
// destructive import unless a MATCHING confirmation (and, unless overridden, a
// pre-destructive snapshot) is supplied.
describe('profile import service - deletion guard (M13-09)', () => {
  const FACTS = [
    '```yaml',
    'facts:',
    '  work_authorization:',
    '    value: "Authorized to work in the US"',
    '    declared: 2026-01-15',
    '```',
    '',
  ].join('\n');

  // A temp profile dir seeded with the fictional example sources + a facts.md.
  async function seedDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), prefix));
    for (const name of [
      PROFILE_SOURCE_FILES.resume,
      PROFILE_SOURCE_FILES.skills,
      PROFILE_SOURCE_FILES.projects,
      PROFILE_SOURCE_FILES.criteria,
    ]) {
      await copyFile(path.join(EXAMPLE_PROFILE_DIR, name), path.join(dir, name));
    }
    await writeFile(path.join(dir, PROFILE_FACTS_FILE), FACTS, 'utf8');
    return dir;
  }

  // Remove one skill row from the temp dir's skills.md -> the next sync deletes
  // that row (a destructive edit).
  async function dropSkill(dir: string, skillName: string): Promise<void> {
    const file = path.join(dir, PROFILE_SOURCE_FILES.skills);
    const kept = (await readFile(file, 'utf8'))
      .split('\n')
      .filter((line) => !line.startsWith(`| ${skillName} `))
      .join('\n');
    await writeFile(file, kept, 'utf8');
  }

  const buildGuarded = (dir: string, snapshotProfile?: () => Promise<void>) =>
    createProfileImportService({ profileDir: dir, profile, facts, criteria, snapshotProfile });

  async function skillCount(userId: string): Promise<number> {
    const { rows } = await handle.pool.query<{ count: string }>(
      `select count(*) from profile_skills where user_id = $1`,
      [userId],
    );
    return Number(rows[0]!.count);
  }

  it('previewImport reports the would-be deletes + a value-free fingerprint, writes nothing', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-preview-');
    await buildGuarded(dir).importProfile(userId);
    const before = await skillCount(userId);
    expect(before).toBeGreaterThan(0);

    await dropSkill(dir, 'Redis');
    const preview = await buildGuarded(dir).previewImport(userId);

    expect(preview.destructive).toBe(true);
    expect(preview.sync.skills.deleted).toBe(1);
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // NO-WRITE: the preview committed nothing.
    expect(await skillCount(userId)).toBe(before);
  });

  it('importGuarded runs a non-destructive import directly (no confirmation needed)', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-nondestructive-');
    let snapshots = 0;
    const summary = await buildGuarded(dir, () => {
      snapshots++;
      return Promise.resolve();
    }).importGuarded(userId);
    expect(summary.sync.skills.inserted).toBeGreaterThan(0);
    // First import only inserts -> not destructive -> snapshot never taken.
    expect(snapshots).toBe(0);
  });

  it('refuses a destructive import with NO confirmation (confirmation_required), deletes nothing', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-noconfirm-');
    await buildGuarded(dir).importProfile(userId);
    const before = await skillCount(userId);
    await dropSkill(dir, 'Redis');

    await expect(buildGuarded(dir).importGuarded(userId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ImportConfirmationError && e.reason === 'confirmation_required',
    );
    expect(await skillCount(userId)).toBe(before);
  });

  it('rejects a WRONG confirmation fingerprint (fingerprint_mismatch)', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-wrongfp-');
    await buildGuarded(dir).importProfile(userId);
    await dropSkill(dir, 'Redis');

    await expect(
      buildGuarded(dir).importGuarded(userId, { confirmDeletes: 'not-the-real-fingerprint' }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ImportConfirmationError && e.reason === 'fingerprint_mismatch',
    );
  });

  it('CAS: a source changed between preview and confirm is rejected (fingerprint_mismatch), deletes nothing', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-cas-');
    await buildGuarded(dir).importProfile(userId);
    const before = await skillCount(userId);

    await dropSkill(dir, 'Redis');
    const stale = await buildGuarded(dir).previewImport(userId);
    expect(stale.destructive).toBe(true);

    // The sources change AGAIN after the preview - the confirm token is now stale.
    await dropSkill(dir, 'Docker');
    await expect(
      buildGuarded(dir).importGuarded(userId, { confirmDeletes: stale.fingerprint }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ImportConfirmationError && e.reason === 'fingerprint_mismatch',
    );
    expect(await skillCount(userId)).toBe(before);
  });

  it('executes a destructive import with a MATCHING confirmation + snapshot (snapshot taken once)', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-confirm-ok-');
    await buildGuarded(dir).importProfile(userId);
    const before = await skillCount(userId);
    await dropSkill(dir, 'Redis');

    let snapshots = 0;
    const service = buildGuarded(dir, () => {
      snapshots++;
      return Promise.resolve();
    });
    const preview = await service.previewImport(userId);
    const summary = await service.importGuarded(userId, { confirmDeletes: preview.fingerprint });

    expect(summary.sync.skills.deleted).toBe(1);
    expect(await skillCount(userId)).toBe(before - 1);
    expect(snapshots).toBe(1); // snapshot ran BEFORE the destructive write
  });

  it('--no-snapshot (skipSnapshot) proceeds without a snapshot capability', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-nosnap-');
    await buildGuarded(dir).importProfile(userId);
    await dropSkill(dir, 'Redis');

    // No snapshotProfile dep at all - skipSnapshot is the explicit override.
    const service = buildGuarded(dir);
    const preview = await service.previewImport(userId);
    const summary = await service.importGuarded(userId, {
      confirmDeletes: preview.fingerprint,
      skipSnapshot: true,
    });
    expect(summary.sync.skills.deleted).toBe(1);
  });

  it('fails closed when a destructive import cannot snapshot (SnapshotUnavailableError), deletes nothing', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-snapfail-');
    await buildGuarded(dir).importProfile(userId);
    const before = await skillCount(userId);
    await dropSkill(dir, 'Redis');

    // No snapshot dep, no skipSnapshot override -> fail closed.
    const service = buildGuarded(dir);
    const preview = await service.previewImport(userId);
    await expect(
      service.importGuarded(userId, { confirmDeletes: preview.fingerprint }),
    ).rejects.toBeInstanceOf(SnapshotUnavailableError);
    expect(await skillCount(userId)).toBe(before);
  });

  it('a snapshot that throws is surfaced as SnapshotUnavailableError, deletes nothing', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-snapthrow-');
    await buildGuarded(dir).importProfile(userId);
    const before = await skillCount(userId);
    await dropSkill(dir, 'Redis');

    const service = buildGuarded(dir, () =>
      Promise.reject(new Error('BACKUP_DIR resolves inside the repository')),
    );
    const preview = await service.previewImport(userId);
    await expect(
      service.importGuarded(userId, { confirmDeletes: preview.fingerprint }),
    ).rejects.toBeInstanceOf(SnapshotUnavailableError);
    expect(await skillCount(userId)).toBe(before);
  });

  it('a shrunk facts.md counts as destructive (facts full-sync delete)', async () => {
    const userId = await insertUser();
    const dir = await seedDir('m1309-facts-destructive-');
    await buildGuarded(dir).importProfile(userId);

    // Remove facts.md entirely: the full-sync would delete the imported fact.
    await rm(path.join(dir, PROFILE_FACTS_FILE));
    const preview = await buildGuarded(dir).previewImport(userId);
    expect(preview.facts.deleted).toBe(1);
    expect(preview.destructive).toBe(true);
  });
});
