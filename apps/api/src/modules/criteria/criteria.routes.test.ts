// GET/PUT /criteria integration tests (M1-08). All values FICTIONAL
// (docs/profile.example/ vocabulary). Criteria values are private profile
// data — these tests also pin the wire shape exactly, so row internals
// (id, user_id) provably never leave the API.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type CriteriaPutBody } from '@careerforge/core';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();

let app: FastifyInstance | undefined;

beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => handle.pool.end());

async function build(): Promise<FastifyInstance> {
  app = await buildApp(env, { dbHandle: handle });
  return app;
}

const fictionalBody = (expectedUpdatedAt: string | null = null): CriteriaPutBody => ({
  hardFilters: { seniority: ['entry_level', 'junior'] },
  positiveSignals: {
    role: ['senior_software_engineer'],
    technologies: ['typescript'],
    problem_domains: ['api_platforms', 'payments_and_fintech'],
    work_arrangement: ['remote_us'],
    scope: ['architecture'],
  },
  negativeSignals: ['frontend_only'],
  forceLowestPriority: { industry: ['multilevel_marketing'] },
  compBounds: { currency: 'usd', base_preferred_min: 100_000, base_preferred_max: 150_000 },
  expectedUpdatedAt,
});

async function authedClient(instance: FastifyInstance) {
  const user = await createTestUser(handle);
  const { token } = await createSessionRow(handle, user.id);
  const cookie = { cookie: `${SESSION_COOKIE_NAME}=${token}` };
  return {
    user,
    get: () => instance.inject({ method: 'GET', url: '/criteria', headers: cookie }),
    put: (payload: unknown, extraHeaders: Record<string, string> = {}) =>
      instance.inject({
        method: 'PUT',
        url: '/criteria',
        headers: { ...cookie, ...extraHeaders },
        payload: payload as Record<string, unknown>,
      }),
  };
}

describe('GET /criteria', () => {
  it('401s without a session (default-deny guard)', async () => {
    const instance = await build();
    const response = await instance.inject({ method: 'GET', url: '/criteria' });
    expect(response.statusCode).toBe(401);
  });

  it('404s CRITERIA_NOT_FOUND before the first import/PUT — explicit, not silent defaults', async () => {
    const instance = await build();
    const { get } = await authedClient(instance);
    const response = await get();
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('CRITERIA_NOT_FOUND');
  });
});

describe('PUT /criteria', () => {
  it('creates on expectedUpdatedAt: null and serves the EXACT wire shape (no id/user_id), GET round-trips it', async () => {
    const instance = await build();
    const { get, put } = await authedClient(instance);

    const created = await put(fictionalBody(null));
    expect(created.statusCode).toBe(200);
    const body = created.json<Record<string, unknown>>();
    const written: Partial<CriteriaPutBody> = { ...fictionalBody(null) };
    delete written.expectedUpdatedAt;
    expect(body).toEqual({
      ...written,
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as unknown,
    });

    const fetched = await get();
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(body);
  });

  it('409s a create when the row already exists (no blind overwrite on the create path)', async () => {
    const instance = await build();
    const { put } = await authedClient(instance);
    await put(fictionalBody(null));
    const second = await put(fictionalBody(null));
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('STALE_CRITERIA');
  });

  it('replaces on a matching pin (the GET-served updatedAt round-trips through the CAS), 409s the stale pin after', async () => {
    const instance = await build();
    const { get, put } = await authedClient(instance);
    await put(fictionalBody(null));
    const pin = (await get()).json<{ updatedAt: string }>().updatedAt;

    const replaced = await put({
      ...fictionalBody(pin),
      negativeSignals: ['unclear_salary'],
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json<{ negativeSignals: string[] }>().negativeSignals).toEqual([
      'unclear_salary',
    ]);

    // The same pin is now stale: 409, and the row is untouched.
    const stale = await put({ ...fictionalBody(pin), negativeSignals: ['agency_body_shop'] });
    expect(stale.statusCode).toBe(409);
    expect((await get()).json<{ negativeSignals: string[] }>().negativeSignals).toEqual([
      'unclear_salary',
    ]);
  });

  it('400s an unknown hardFilters key VALUE-FREE — the domain-law closed key set holds on the wire too', async () => {
    const instance = await build();
    const { put } = await authedClient(instance);
    const smuggled = fictionalBody(null);
    (smuggled.hardFilters as Record<string, unknown>).problem_domains = ['payments_and_fintech'];
    const response = await put(smuggled);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    // Paths + issue codes only — the smuggled key's VALUE never round-trips.
    expect(response.body).not.toContain('payments_and_fintech');
  });

  it('403s a foreign Origin (the CSRF check covers the new mutation)', async () => {
    const instance = await build();
    const { put } = await authedClient(instance);
    const response = await put(fictionalBody(null), { origin: 'https://evil.example.com' });
    expect(response.statusCode).toBe(403);
  });
});
