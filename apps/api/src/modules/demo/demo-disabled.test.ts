// DEMO_DISABLED envelope (M10-03): when DEMO_MODE is on, the eight LLM-draft
// POSTs return DEMO_DISABLED (403) instead of reaching the provider, and the
// refusal fires at onRequest — before body validation and before the service's
// keyless 503 check (precedence). Registered AFTER the auth guard, so an
// unauthenticated caller still gets 401, never the demo 403 (the ratified
// amendment). When DEMO_MODE is off the hook is not registered at all — the same
// route validates and runs exactly as before. `/learning-plans` stands in for
// all eight (the pin test in auth.routes.test.ts fixes the full marked set).
// Every credential here is fictional (ADR-0007).
import { afterEach, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const demoEnv = buildTestEnv({ DEMO_MODE: '1' }); // keyless demo (no ANTHROPIC_API_KEY)
const plainEnv = buildTestEnv(); // DEMO_MODE off

let app: FastifyInstance | undefined;
beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => handle.pool.end());

async function build(env = demoEnv, deps: AppDeps = {}): Promise<FastifyInstance> {
  app = await buildApp(env, { dbHandle: handle, ...deps });
  return app;
}

let userSequence = 0;
async function authCookie(): Promise<string> {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `demo.visitor.${userSequence}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe('DEMO_DISABLED (M10-03)', () => {
  it('an authenticated LLM-draft POST returns 403 DEMO_DISABLED in demo mode', async () => {
    const instance = await build(demoEnv);
    const response = await instance.inject({
      method: 'POST',
      url: '/learning-plans',
      headers: { cookie: await authCookie() },
      payload: { gapIds: ['00000000-0000-0000-0000-000000000000'] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('DEMO_DISABLED');
  });

  it('the refusal fires before body validation (onRequest precedence)', async () => {
    // An empty body would normally fail validation (400). In demo the hook wins.
    const instance = await build(demoEnv);
    const response = await instance.inject({
      method: 'POST',
      url: '/learning-plans',
      headers: { cookie: await authCookie() },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('DEMO_DISABLED');
  });

  it('an UNAUTHENTICATED LLM-draft POST in demo stays 401, never the demo 403', async () => {
    const instance = await build(demoEnv);
    const response = await instance.inject({
      method: 'POST',
      url: '/learning-plans',
      payload: { gapIds: ['00000000-0000-0000-0000-000000000000'] },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('UNAUTHORIZED');
  });

  it('is INERT when DEMO_MODE is off: the same route validates and runs normally', async () => {
    // Same empty-body request that demo turns into 403 gets normal validation
    // (400) here — proof the hook is not registered and nothing else changed.
    const instance = await build(plainEnv);
    const response = await instance.inject({
      method: 'POST',
      url: '/learning-plans',
      headers: { cookie: await authCookie() },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).not.toBe('DEMO_DISABLED');
  });
});
