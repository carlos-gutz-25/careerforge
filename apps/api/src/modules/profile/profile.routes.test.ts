// POST /profile/import integration tests. The parsed directory is ALWAYS
// injected: docs/profile.example/ (fictional) or the malformed fictional
// fixture — never the real docs/profile/ (RISKS P-01). buildApp's test-env
// default is a nonexistent sentinel, asserted below, so forgetting the
// injection cannot fall back to real career data.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
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

  it('422s on malformed sources with file + line per issue, importing nothing', async () => {
    const instance = await build({ profileDir: MALFORMED_PROFILE_DIR });
    const { user, post } = await authedImport(instance);

    const response = await post();
    expect(response.statusCode).toBe(422);
    const body = response.json<{
      error: { code: string; message: string; issues: { file: string; line: number }[] };
    }>();
    expect(body.error.code).toBe('PROFILE_PARSE_ERROR');
    expect(body.error.issues).toEqual([
      expect.objectContaining({ file: 'resume.md', line: 17 }),
      expect.objectContaining({ file: 'skills.md', line: 8 }),
      expect.objectContaining({ file: 'projects.md', line: 5 }),
    ]);

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
    const body = response.json<{ error: { issues: { message: string }[] } }>();
    expect(body.error.issues[0]?.message).toContain('file not found');
  });
});
