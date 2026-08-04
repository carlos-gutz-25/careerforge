// Demo mutation rate limit (M10-03): when DEMO_MODE is on, mutating requests are
// throttled per client IP with the hand-rolled fixed-window limiter, POST
// /auth/login exempt (its own stricter limiter). Reads are unlimited; off-demo
// the hook is not registered at all. A cheap public POST probe route exercises
// the limiter without DB writes. All credentials fictional (ADR-0007).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp } from '../../app.ts';
import { buildTestEnv, ORIGIN_HEADER } from '../../test/auth-test-helpers.ts';
import { DEMO_MUTATION_RATE_LIMIT_MAX, DEMO_MUTATION_RATE_LIMIT_WINDOW_MS } from './demo.hooks.ts';

const handle = createTestDb();
const demoEnv = buildTestEnv({ DEMO_MODE: '1' });
const plainEnv = buildTestEnv();

let app: FastifyInstance | undefined;
beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => handle.pool.end());

async function buildWithProbe(env = demoEnv): Promise<FastifyInstance> {
  app = await buildApp(env, { dbHandle: handle });
  // Cheap public mutating route: exercises the limiter with no DB writes.
  // Promise-returning (not `async`) handler: Fastify needs the promise-style
  // handler here, but an await-less `async` trips require-await - returning a
  // resolved promise satisfies both.
  app.post('/rl-probe', { config: { public: true } }, () => Promise.resolve({ ok: true }));
  await app.ready();
  return app;
}

describe('demo mutation rate limit (M10-03)', () => {
  it('pins the constants', () => {
    expect(DEMO_MUTATION_RATE_LIMIT_MAX).toBe(60);
    expect(DEMO_MUTATION_RATE_LIMIT_WINDOW_MS).toBe(10 * 60_000);
  });

  it('allows up to the max then 429s further mutations in demo', async () => {
    const instance = await buildWithProbe(demoEnv);
    for (let i = 0; i < DEMO_MUTATION_RATE_LIMIT_MAX; i += 1) {
      const r = await instance.inject({
        method: 'POST',
        url: '/rl-probe',
        headers: { ...ORIGIN_HEADER },
      });
      expect(r.statusCode).toBe(200);
    }
    const over = await instance.inject({
      method: 'POST',
      url: '/rl-probe',
      headers: { ...ORIGIN_HEADER },
    });
    expect(over.statusCode).toBe(429);
    expect(over.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMITED');
    expect(over.headers['retry-after']).toBeDefined();
  });

  it('exempts POST /auth/login from the demo mutation budget', async () => {
    const instance = await buildWithProbe(demoEnv);
    for (let i = 0; i < DEMO_MUTATION_RATE_LIMIT_MAX; i += 1) {
      await instance.inject({ method: 'POST', url: '/rl-probe', headers: { ...ORIGIN_HEADER } });
    }
    // The demo budget for this IP is now exhausted for non-login mutations...
    const over = await instance.inject({
      method: 'POST',
      url: '/rl-probe',
      headers: { ...ORIGIN_HEADER },
    });
    expect(over.statusCode).toBe(429);
    // ...but login is exempt, so it reaches the login flow (401 for bad creds).
    const login = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { ...ORIGIN_HEADER },
      payload: { email: 'nobody.fictional@example.com', password: 'wrong-password-fictional' },
    });
    expect(login.statusCode).not.toBe(429);
    expect(login.statusCode).toBe(401);
  });

  it('never throttles reads (GET) in demo', async () => {
    const instance = await buildWithProbe(demoEnv);
    for (let i = 0; i < DEMO_MUTATION_RATE_LIMIT_MAX + 5; i += 1) {
      const r = await instance.inject({ method: 'GET', url: '/health' });
      expect(r.statusCode).toBe(200);
    }
  });

  it('is INERT when DEMO_MODE is off: mutations past the max still pass', async () => {
    const instance = await buildWithProbe(plainEnv);
    for (let i = 0; i < DEMO_MUTATION_RATE_LIMIT_MAX + 2; i += 1) {
      const r = await instance.inject({
        method: 'POST',
        url: '/rl-probe',
        headers: { ...ORIGIN_HEADER },
      });
      expect(r.statusCode).toBe(200);
    }
  });
});
