import { afterAll, describe, expect, it } from 'vitest';

import { type DbHandle } from './client.ts';
import { checkDbReady } from './readiness.ts';
import { createTestDb } from './test/db-test-utils.ts';

const handle = createTestDb();
afterAll(() => handle.pool.end());

describe('checkDbReady', () => {
  it('returns true when the database answers SELECT 1 (integration)', async () => {
    expect(await checkDbReady(handle)).toBe(true);
  });

  it('returns false without throwing, and never leaks the error detail, when the query rejects', async () => {
    const secret = 'connection refused: password=hunter2 at pg.internal:5432';
    const failing = {
      pool: { query: () => Promise.reject(new Error(secret)) },
    } as unknown as DbHandle;
    // resolves (not rejects) to a bare boolean - no error object escapes.
    await expect(checkDbReady(failing)).resolves.toBe(false);
  });

  it('returns false on timeout without waiting for a hung query', async () => {
    const hanging = {
      pool: { query: () => new Promise(() => {}) },
    } as unknown as DbHandle;
    const start = Date.now();
    expect(await checkDbReady(hanging, 20)).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
