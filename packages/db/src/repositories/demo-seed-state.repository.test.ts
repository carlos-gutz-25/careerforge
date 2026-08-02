import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { demoSeedState } from '../schema/demo-seed-state.ts';
import { createDemoSeedStateRepository } from './demo-seed-state.repository.ts';

// Integration tests for the M10-03 demo_seed_state singleton marker (dockerized
// Postgres, migration 0025). Nothing here is real data — the marker is pure
// infrastructure state.
const handle = createTestDb();
const repo = createDemoSeedStateRepository(handle.db);
const rejectsWith = (code: string) => (error: unknown) => pgErrorCode(error) === code;

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

describe('demo_seed_state (M10-03, migration 0025)', () => {
  it('read is undefined on an unseeded instance', async () => {
    expect(await repo.read()).toBeUndefined();
  });

  it('upsert writes the singleton (id 1) and read returns it', async () => {
    const row = await repo.upsert({
      fixtureSetVersion: 'v1',
      fixtureManifestSha256: 'a'.repeat(64),
    });
    expect(row.id).toBe(1);
    expect(row.fixtureSetVersion).toBe('v1');

    const read = await repo.read();
    expect(read?.id).toBe(1);
    expect(read?.fixtureManifestSha256).toBe('a'.repeat(64));
  });

  it('upsert is idempotent — a re-seed refreshes in place, still one row', async () => {
    await repo.upsert({ fixtureSetVersion: 'v1', fixtureManifestSha256: 'a'.repeat(64) });
    const second = await repo.upsert({
      fixtureSetVersion: 'v2',
      fixtureManifestSha256: 'b'.repeat(64),
    });
    expect(second.id).toBe(1);
    expect(second.fixtureSetVersion).toBe('v2');

    const all = await handle.db.select().from(demoSeedState);
    expect(all).toHaveLength(1);
  });

  it('the CHECK pins id to 1 — an id != 1 row is rejected (23514)', async () => {
    await expect(
      handle.db
        .insert(demoSeedState)
        .values({ id: 2, fixtureSetVersion: 'v', fixtureManifestSha256: 'c'.repeat(64) }),
    ).rejects.toSatisfy(rejectsWith('23514'));
  });
});
