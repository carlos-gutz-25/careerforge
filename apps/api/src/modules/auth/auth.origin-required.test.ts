// M13-06: fail-closed CSRF Origin posture (branch (a), ADR-0007 amended).
// A mutating request (POST/PUT/PATCH/DELETE) MUST carry an Origin the browser
// sends same-origin; absent OR mismatched is rejected 403, BEFORE the public
// bypass and BEFORE the session check. The old absent-passes carve-out is gone.
import { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp } from '../../app.ts';
import { SESSION_COOKIE_NAME } from './auth.service.ts';
import {
  buildTestEnv,
  createSessionRow,
  createTestUser,
  ORIGIN_HEADER,
  TEST_USER,
} from '../../test/auth-test-helpers.ts';

const handle = createTestDb();
const env = buildTestEnv();

let app: FastifyInstance | undefined;

beforeEach(async () => {
  await truncateAllTables(handle);
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => {
  await handle.pool.end();
});

async function build(): Promise<FastifyInstance> {
  app = await buildApp(env, { dbHandle: handle });
  return app;
}

const cookie = (token: string) => ({ cookie: `${SESSION_COOKIE_NAME}=${token}` });
const credentials = { email: TEST_USER.email, password: TEST_USER.password };

describe('M13-06 fail-closed Origin on mutating routes', () => {
  it('rejects a mutation with NO Origin - 403 "origin header required" (public login route)', async () => {
    const instance = await build();
    await createTestUser(handle);

    const res = await instance.inject({ method: 'POST', url: '/auth/login', body: credentials });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'FORBIDDEN_ORIGIN', message: 'origin header required' },
    });
  });

  it('rejects a NO-Origin mutation on a guarded route BEFORE the session check (403, not 401)', async () => {
    const instance = await build();
    const user = await createTestUser(handle);
    const { token } = await createSessionRow(handle, user.id);

    // A valid session is present; the missing Origin still wins (check order).
    const res = await instance.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('rejects a MISMATCHED Origin - 403 "cross-origin request rejected" (regression)', async () => {
    const instance = await build();
    await createTestUser(handle);

    const res = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      body: credentials,
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'FORBIDDEN_ORIGIN', message: 'cross-origin request rejected' },
    });
  });

  it('accepts a mutation carrying the correct Origin (login succeeds)', async () => {
    const instance = await build();
    await createTestUser(handle);

    const res = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      body: credentials,
      headers: { ...ORIGIN_HEADER },
    });
    expect(res.statusCode).toBe(200);
  });

  it('runs the Origin check before the session check: correct Origin + no session -> 401', async () => {
    const instance = await build();

    const res = await instance.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { ...ORIGIN_HEADER },
    });
    expect(res.statusCode).toBe(401);
  });

  it('does NOT gate GET requests on Origin (no Origin -> still served)', async () => {
    const instance = await build();

    const res = await instance.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
