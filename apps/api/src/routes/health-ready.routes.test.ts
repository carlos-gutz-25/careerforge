// GET /health/ready (M13-04). The happy 200 is an integration leg against the
// dockerized scratch DB (a real SELECT 1); every failure/cache case injects a
// `checkReady` stub, so the DB is NEVER stopped to prove a 503 (AC 6).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { type AppDeps } from '../app.ts';
import { buildTestEnv } from '../test/auth-test-helpers.ts';

describe('GET /health/ready (M13-04)', () => {
  const opened: Awaited<ReturnType<typeof buildApp>>[] = [];
  async function make(deps: AppDeps = {}) {
    const app = await buildApp(buildTestEnv(), deps);
    opened.push(app);
    return app;
  }
  afterEach(async () => {
    for (const app of opened.splice(0)) await app.close();
    vi.useRealTimers();
  });

  it('returns 200 {status:ready} when the database answers (integration, real scratch DB)', async () => {
    const app = await make(); // default checkReady = real SELECT 1
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it('returns 503 {status:unavailable} with no DB internals when readiness fails (injected)', async () => {
    const app = await make({ checkReady: () => Promise.resolve(false) });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
    // sanitized: the boolean seam guarantees no host/password/stack can leak.
    expect(response.payload).not.toMatch(/password|pg\.internal|\n\s+at /);
  });

  it('is public: probeable without a session', async () => {
    const app = await make({ checkReady: () => Promise.resolve(true) });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
  });

  it('caches the verdict: 10 rapid calls single-flight onto ONE ping', async () => {
    const checkReady = vi.fn().mockResolvedValue(true);
    const app = await make({ checkReady });
    await Promise.all(
      Array.from({ length: 10 }, () => app.inject({ method: 'GET', url: '/health/ready' })),
    );
    expect(checkReady).toHaveBeenCalledTimes(1);
  });

  it('re-pings once the cache window elapses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // fake Date only; leave inject timers real
    const checkReady = vi.fn().mockResolvedValue(true);
    const app = await make({ checkReady });
    const start = Date.now();
    await app.inject({ method: 'GET', url: '/health/ready' });
    expect(checkReady).toHaveBeenCalledTimes(1);
    vi.setSystemTime(start + 1600); // past READINESS_CACHE_MS (1500)
    await app.inject({ method: 'GET', url: '/health/ready' });
    expect(checkReady).toHaveBeenCalledTimes(2);
  });
});
