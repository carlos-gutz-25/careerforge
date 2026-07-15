// POST /profile/import integration tests. The parsed directory is ALWAYS
// injected: docs/profile.example/ (fictional) or the malformed fictional
// fixture — never the real docs/profile/ (RISKS P-01). buildApp's test-env
// default is a nonexistent sentinel, asserted below, so forgetting the
// injection cannot fall back to real career data.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { createProfileRepository, type ProfileImportData } from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
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
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
  return { user, post };
}

describe('POST /profile/import', () => {
  it('401s without a session (default-deny guard)', async () => {
    const instance = await build({ profileDir: EXAMPLE_PROFILE_DIR });
    const response = await instance.inject({ method: 'POST', url: '/profile/import' });
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
      },
      totals: { skills: 8, experiences: 3, projects: 3 },
    });

    const second = await post();
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({
      sync: {
        skills: { inserted: 0, updated: 0, deleted: 0 },
        experiences: { inserted: 0, updated: 0, deleted: 0 },
        projects: { inserted: 0, updated: 0, deleted: 0 },
      },
      totals: { skills: 8, experiences: 3, projects: 3 },
    });
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
    ]);
    // The fixture's raw cell values must never be echoed by the API.
    expect(response.body).not.toMatch(/whenever|sometime|legendary/i);

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

// Fictional rows seeded straight through the repository (not the parser):
// GET /profile reads the DB; which importer wrote it is irrelevant here.
function seededRows(): ProfileImportData {
  return {
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
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
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
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
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
          level: 'expert',
          years: 5,
          lastUsed: null,
        },
        {
          id: anyString,
          name: 'python',
          category: 'language',
          level: 'rusty',
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
