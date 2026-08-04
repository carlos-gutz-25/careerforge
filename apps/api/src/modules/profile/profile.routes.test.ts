// POST /profile/import integration tests. The parsed directory is ALWAYS
// injected: docs/profile.example/ (fictional) or the malformed fictional
// fixture — never the real docs/profile/ (RISKS P-01). buildApp's test-env
// default is a nonexistent sentinel, asserted below, so forgetting the
// injection cannot fall back to real career data.
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  createProfileRepository,
  createSearchCriteriaRepository,
  seed,
  SEED_USER_EMAIL,
  type ProfileImportData,
} from '@careerforge/db';
import { createTestDb, resumeHeaderFixture, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import {
  buildTestEnv,
  createSessionRow,
  createTestUser,
  ORIGIN_HEADER,
} from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';
import { EXAMPLE_PROFILE_DIR, MALFORMED_PROFILE_DIR } from './fixture-dirs.ts';

const handle = createTestDb();
const env = buildTestEnv();

let app: FastifyInstance | undefined;

beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => handle.pool.end());

async function build(deps: AppDeps = {}): Promise<FastifyInstance> {
  app = await buildApp(env, { dbHandle: handle, ...deps });
  return app;
}

async function authedImport(instance: FastifyInstance) {
  const user = await createTestUser(handle);
  const { token } = await createSessionRow(handle, user.id);
  const post = () =>
    instance.inject({
      method: 'POST',
      url: '/profile/import',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER },
    });
  return { user, post };
}

describe('POST /profile/import', () => {
  it('401s without a session (default-deny guard)', async () => {
    const instance = await build({ profileDir: EXAMPLE_PROFILE_DIR });
    const response = await instance.inject({
      method: 'POST',
      url: '/profile/import',
      headers: { ...ORIGIN_HEADER },
    });
    expect(response.statusCode).toBe(401);
  });

  it('imports the example profile into the session user and is idempotent', async () => {
    const instance = await build({ profileDir: EXAMPLE_PROFILE_DIR });
    const { post } = await authedImport(instance);

    const first = await post();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      sync: {
        skills: { inserted: 8, updated: 0, deleted: 0 },
        experiences: { inserted: 3, updated: 0, deleted: 0 },
        projects: { inserted: 3, updated: 0, deleted: 0 },
        // M6-01: the example carries one contact block, one summary
        // paragraph, and one education entry.
        contact: { inserted: 1, updated: 0, deleted: 0 },
        summaries: { inserted: 1, updated: 0, deleted: 0 },
        education: { inserted: 1, updated: 0, deleted: 0 },
      },
      // M12-03: the example facts.md declares five durable facts.
      facts: { inserted: 5, updated: 0, deleted: 0 },
      totals: { skills: 8, experiences: 3, projects: 3, contact: 1, summaries: 1, education: 1 },
      criteria: { outcome: 'created' },
    });

    const second = await post();
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({
      sync: {
        skills: { inserted: 0, updated: 0, deleted: 0 },
        experiences: { inserted: 0, updated: 0, deleted: 0 },
        projects: { inserted: 0, updated: 0, deleted: 0 },
        contact: { inserted: 0, updated: 0, deleted: 0 },
        summaries: { inserted: 0, updated: 0, deleted: 0 },
        education: { inserted: 0, updated: 0, deleted: 0 },
      },
      facts: { inserted: 0, updated: 0, deleted: 0 },
      totals: { skills: 8, experiences: 3, projects: 3, contact: 1, summaries: 1, education: 1 },
      criteria: { outcome: 'unchanged' },
    });
  });

  it('import over the freshly SEEDED row reports criteria `unchanged` — the seed<->example<->import no-op triangle (M1-08)', async () => {
    // The M0-08 idempotency evidence, criteria edition: the seed writes the
    // example file's fictional-analog values, so importing the example over
    // it changes nothing.
    await seed(handle.db);
    const { rows } = await handle.pool.query<{ id: string }>(
      `select id from users where email = $1`,
      [SEED_USER_EMAIL],
    );
    const seedUserId = rows[0]!.id;
    const instance = await build({ profileDir: EXAMPLE_PROFILE_DIR });
    const { token } = await createSessionRow(handle, seedUserId);
    const response = await instance.inject({
      method: 'POST',
      url: '/profile/import',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ criteria: { outcome: string } }>().criteria).toEqual({
      outcome: 'unchanged',
    });
  });

  it('differing criteria + otherwise-valid files: profile tables SYNC and criteria is `skipped_existing` (M1-08 collision rule)', async () => {
    const instance = await build({ profileDir: EXAMPLE_PROFILE_DIR });
    const { user, post } = await authedImport(instance);
    const criteriaRepo = createSearchCriteriaRepository(handle.db);

    const first = await post();
    expect(first.json<{ criteria: { outcome: string } }>().criteria.outcome).toBe('created');

    // Diverge the row (stands in for a PUT edit), and remove one skill so a
    // successful re-sync is observable.
    const imported = await criteriaRepo.get(user.id);
    const altered = {
      hardFilters: imported!.hardFilters,
      positiveSignals: imported!.positiveSignals,
      negativeSignals: ['agency_body_shop'],
      forceLowestPriority: imported!.forceLowestPriority,
      compBounds: imported!.compBounds,
    };
    await criteriaRepo.upsert(user.id, altered);
    await handle.pool.query(
      `delete from profile_skills where user_id = $1 and lower(name) = 'redis'`,
      [user.id],
    );

    const second = await post();
    expect(second.statusCode).toBe(200);
    const body = second.json<{
      sync: { skills: { inserted: number } };
      criteria: { outcome: string };
    }>();
    // The skip never blocks the table sync...
    expect(body.sync.skills.inserted).toBe(1);
    expect(body.criteria.outcome).toBe('skipped_existing');
    // ...and never overwrites: the divergent row survives (HTTP cannot force).
    const after = await criteriaRepo.get(user.id);
    expect(after!.negativeSignals).toEqual(['agency_body_shop']);
  });

  it('422s on malformed sources with redacted issues (file/line/field/rule, no values), importing nothing', async () => {
    const instance = await build({ profileDir: MALFORMED_PROFILE_DIR });
    const { user, post } = await authedImport(instance);

    const response = await post();
    expect(response.statusCode).toBe(422);
    const body = response.json<{
      error: {
        code: string;
        message: string;
        issues: { file: string; line: number; field: string; rule: string }[];
      };
    }>();
    expect(body.error.code).toBe('PROFILE_PARSE_ERROR');
    // Exact objects (not objectContaining): also proves `message` — which
    // quotes profile content — is absent from the HTTP body (RISKS P-01).
    expect(body.error.issues).toEqual([
      { file: 'resume.md', line: 17, field: 'period', rule: 'invalid-value' },
      { file: 'skills.md', line: 8, field: 'level', rule: 'invalid-value' },
      { file: 'projects.md', line: 5, field: 'provenance', rule: 'missing-field' },
      // The fixture's criteria defect is the DOMAIN-LAW smuggle: a scoring
      // vocabulary under exclude_when is a parse error (closed key set), and
      // a broken criteria file blocks the whole import (all-or-nothing).
      { file: 'job-criteria.md', line: 9, field: 'exclude_when', rule: 'invalid-value' },
    ]);
    // The fixture's raw cell values must never be echoed by the API — nor
    // the criteria message content (the smuggled key name stays CLI-only).
    expect(response.body).not.toMatch(/whenever|sometime|legendary|payments_and_fintech/i);

    const { rows } = await handle.pool.query<{ count: string }>(
      `select count(*) from profile_skills where user_id = $1`,
      [user.id],
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('defaults to a nonexistent sentinel dir under NODE_ENV=test — the real docs/profile/ is unreachable', async () => {
    const instance = await build(); // profileDir deliberately not injected
    const { post } = await authedImport(instance);

    const response = await post();
    expect(response.statusCode).toBe(422);
    const body = response.json<{ error: { issues: { rule: string; line: number }[] } }>();
    expect(body.error.issues[0]).toMatchObject({ rule: 'file-missing', line: 1 });
  });
});

// M13-09 (F-7): the import deletion guard over HTTP. A destructive import needs a
// { confirmDeletes } fingerprint AND (production) a snapshot; the route never
// forces criteria and never skips the snapshot (D4).
describe('POST /profile/import - deletion guard (M13-09)', () => {
  async function seedDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'm1309-route-'));
    for (const name of ['resume.md', 'skills.md', 'projects.md', 'job-criteria.md', 'facts.md']) {
      await copyFile(path.join(EXAMPLE_PROFILE_DIR, name), path.join(dir, name));
    }
    return dir;
  }

  async function dropSkill(dir: string, skillName: string): Promise<void> {
    const file = path.join(dir, 'skills.md');
    const kept = (await readFile(file, 'utf8'))
      .split('\n')
      .filter((line) => !line.startsWith(`| ${skillName} `))
      .join('\n');
    await writeFile(file, kept, 'utf8');
  }

  // An authed poster against `dir`, with an optional injected snapshot stub.
  async function setup(dir: string, snapshotProfile?: () => Promise<void>) {
    const instance = await build({ profileDir: dir, snapshotProfile });
    const user = await createTestUser(handle);
    const { token } = await createSessionRow(handle, user.id);
    const post = (payload?: object) =>
      instance.inject({
        method: 'POST',
        url: '/profile/import',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER },
        // undefined payload = no body (the back-compat plain-import shape).
        payload,
      });
    return { post, user };
  }

  async function skillCount(userId: string): Promise<number> {
    const { rows } = await handle.pool.query<{ count: string }>(
      `select count(*) from profile_skills where user_id = $1`,
      [userId],
    );
    return Number(rows[0]!.count);
  }

  it('{ preview: true } returns the would-be deltas + fingerprint and writes nothing', async () => {
    const dir = await seedDir();
    const { post, user } = await setup(dir);
    await post(); // first (non-destructive) import
    const before = await skillCount(user.id);
    await dropSkill(dir, 'Redis');

    const response = await post({ preview: true });
    expect(response.statusCode).toBe(200);
    const preview = response.json<{
      destructive: boolean;
      fingerprint: string;
      sync: { skills: { deleted: number } };
    }>();
    expect(preview.destructive).toBe(true);
    expect(preview.sync.skills.deleted).toBe(1);
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // No criteria/values on the wire; nothing written.
    expect(await skillCount(user.id)).toBe(before);
  });

  it('refuses a destructive import with no confirmation (409 import_confirmation_required), deletes nothing', async () => {
    const dir = await seedDir();
    const { post, user } = await setup(dir);
    await post();
    const before = await skillCount(user.id);
    await dropSkill(dir, 'Redis');

    const response = await post(); // no body -> plain import, but it's destructive
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'import_confirmation_required',
    );
    expect(await skillCount(user.id)).toBe(before);
  });

  it('rejects a stale/wrong confirmation fingerprint (409), deletes nothing', async () => {
    const dir = await seedDir();
    const { post, user } = await setup(dir);
    await post();
    const before = await skillCount(user.id);
    await dropSkill(dir, 'Redis');

    const response = await post({ confirmDeletes: 'not-the-real-fingerprint' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'import_confirmation_required',
    );
    expect(await skillCount(user.id)).toBe(before);
  });

  it('executes a destructive import with a matching fingerprint + snapshot (snapshot taken once)', async () => {
    const dir = await seedDir();
    let snapshots = 0;
    const { post, user } = await setup(dir, () => {
      snapshots++;
      return Promise.resolve();
    });
    await post();
    const before = await skillCount(user.id);
    await dropSkill(dir, 'Redis');

    const preview = await post({ preview: true });
    const { fingerprint } = preview.json<{ fingerprint: string }>();
    const response = await post({ confirmDeletes: fingerprint });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ sync: { skills: { deleted: number } } }>().sync.skills.deleted).toBe(1);
    expect(await skillCount(user.id)).toBe(before - 1);
    expect(snapshots).toBe(1);
  });

  it('fails closed (409) when a destructive import cannot be snapshotted - directs to the CLI', async () => {
    const dir = await seedDir();
    // No snapshot capability injected: test-env default is undefined -> the route
    // cannot snapshot and has no --no-snapshot override (D4).
    const { post, user } = await setup(dir);
    await post();
    const before = await skillCount(user.id);
    await dropSkill(dir, 'Redis');

    const preview = await post({ preview: true });
    const { fingerprint } = preview.json<{ fingerprint: string }>();
    const response = await post({ confirmDeletes: fingerprint });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'import_snapshot_unavailable',
    );
    expect(await skillCount(user.id)).toBe(before);
  });

  it('rejects an unknown body field (strict body schema)', async () => {
    const dir = await seedDir();
    const { post } = await setup(dir);
    const response = await post({ bogusField: true });
    expect(response.statusCode).toBe(400);
  });
});

// Fictional rows seeded straight through the repository (not the parser):
// GET /profile reads the DB; which importer wrote it is irrelevant here.
function seededRows(): ProfileImportData {
  return {
    // GET /profile does not read the M6-01 header tables (they land with their
    // M6-04 consumer), so the header is present but never appears on the wire.
    ...resumeHeaderFixture(),
    skills: [
      { name: 'Vue', category: 'framework', level: 'expert', years: 5, lastUsed: null },
      { name: 'python', category: 'language', level: 'rusty', years: 4, lastUsed: '2016-01-01' },
    ],
    experiences: [
      {
        company: 'Acme Analytics Co.',
        title: 'Senior Software Engineer',
        startDate: '2020-03-01',
        endDate: null,
        // Seeded WITH a bullet on purpose: the GET /profile wire assertion
        // below has NO bullets field, proving the response schema strips them
        // (export-only — the web UI is unchanged by M2-12).
        bullets: ['A fictional bullet that must not reach the GET /profile wire.'],
      },
    ],
    projects: [
      {
        name: 'Reporting Dashboard Modernization',
        company: 'Acme Analytics Co.',
        provenance: 'professional',
        summary: 'Modernized a fictional reporting platform.',
      },
      { name: 'Garden Tracker', company: null, provenance: 'personal_ai_assisted', summary: null },
    ],
  };
}

// expect.any(String) is typed `any`; one cast keeps the asymmetric matcher
// usable inside typed expected objects without per-line suppressions.
const anyString = expect.any(String) as string;

describe('GET /profile', () => {
  it('401s without a session (default-deny guard)', async () => {
    const instance = await build();
    const response = await instance.inject({ method: 'GET', url: '/profile' });
    expect(response.statusCode).toBe(401);
  });

  it('returns an empty profile for a user with no rows', async () => {
    const instance = await build();
    const user = await createTestUser(handle);
    const { token } = await createSessionRow(handle, user.id);
    const response = await instance.inject({
      method: 'GET',
      url: '/profile',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ skills: [], experiences: [], projects: [] });
  });

  it('serves the session user rows in exactly the packages/core wire shape', async () => {
    const instance = await build();
    const user = await createTestUser(handle);
    const { token } = await createSessionRow(handle, user.id);
    await createProfileRepository(handle.db).syncProfile(user.id, seededRows());

    const response = await instance.inject({
      method: 'GET',
      url: '/profile',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER },
    });

    expect(response.statusCode).toBe(200);
    // toEqual is exact: a stray user_id/created_at/updated_at on any row —
    // i.e. the serializer NOT stripping undeclared DB fields — fails this.
    expect(response.json()).toEqual({
      skills: [
        {
          id: anyString,
          name: 'Vue',
          category: 'framework',
          // M3-06: effective level + raw declared. No grants here, so equal.
          level: 'expert',
          declaredLevel: 'expert',
          years: 5,
          lastUsed: null,
        },
        {
          id: anyString,
          name: 'python',
          category: 'language',
          level: 'rusty',
          declaredLevel: 'rusty',
          years: 4,
          lastUsed: '2016-01-01',
        },
      ],
      experiences: [
        {
          id: anyString,
          company: 'Acme Analytics Co.',
          title: 'Senior Software Engineer',
          startDate: '2020-03-01',
          endDate: null,
        },
      ],
      projects: [
        {
          id: anyString,
          experienceId: null,
          name: 'Garden Tracker',
          provenance: 'personal_ai_assisted',
          summary: null,
        },
        {
          id: anyString,
          experienceId: anyString,
          name: 'Reporting Dashboard Modernization',
          provenance: 'professional',
          summary: 'Modernized a fictional reporting platform.',
        },
      ],
    });
  });
});
