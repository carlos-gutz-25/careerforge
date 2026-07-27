// Import-service integration tests for the M1-08 criteria leg paths the HTTP
// route deliberately cannot reach (--force) or cannot observe (all-or-
// nothing rollback). Directories: docs/profile.example/ (fictional) or a
// temp copy of it — never the real docs/profile/ (RISKS P-01).
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createProfileRepository, createSearchCriteriaRepository } from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { EXAMPLE_PROFILE_DIR } from './fixture-dirs.ts';
import { ProfileParseError } from './parse-errors.ts';
import { createProfileImportService, PROFILE_SOURCE_FILES } from './profile.service.ts';

const handle = createTestDb();
const profile = createProfileRepository(handle.db);
const criteria = createSearchCriteriaRepository(handle.db);

const buildService = (profileDir: string) =>
  createProfileImportService({ profileDir, profile, criteria });

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
