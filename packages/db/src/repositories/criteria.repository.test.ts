import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type SearchCriteriaData } from '@careerforge/core';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { createSearchCriteriaRepository } from './criteria.repository.ts';

// Integration coverage for the criteria write paths (M1-08): the importer's
// gated upsert and PUT /criteria's compare-and-swap. Fixture values are
// fictional (docs/profile.example/ vocabulary).
const handle = createTestDb();
const { pool, db } = handle;
const repo = createSearchCriteriaRepository(db);

async function insertUser(email = 'alex.rivera.example@example.com'): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into users (email, password_hash) values ($1, 'fake-hash') returning id`,
    [email],
  );
  return result.rows[0]!.id;
}

const fictionalCriteria = (): SearchCriteriaData => ({
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
});

/** The wire round-trip: what a client read via GET and now pins its PUT to.
 *  Deliberately truncates to milliseconds like an ISO string does — the CAS
 *  must match DB-defaulted (microsecond) timestamps through this. */
const asWirePin = (updatedAt: Date) => new Date(updatedAt.toISOString());

/** updated_at compares at millisecond precision, so two writes inside the
 *  same millisecond would be indistinguishable — space them out. */
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => truncateAllTables(handle));
afterAll(() => pool.end());

describe('search criteria repository (integration)', () => {
  it('get returns undefined before the first write', async () => {
    const userId = await insertUser();
    expect(await repo.get(userId)).toBeUndefined();
  });

  it('upsert creates, then replaces AND bumps updated_at (CAS soundness)', async () => {
    const userId = await insertUser();
    const created = await repo.upsert(userId, fictionalCriteria());
    expect(created.negativeSignals).toEqual(['frontend_only']);

    await nextMillisecond();
    const replaced = await repo.upsert(userId, {
      ...fictionalCriteria(),
      negativeSignals: ['frontend_only', 'unclear_salary'],
    });
    expect(replaced.id).toBe(created.id);
    expect(replaced.negativeSignals).toEqual(['frontend_only', 'unclear_salary']);
    expect(replaced.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
  });

  it('replaceIfUnchanged(null) creates once; an existing row is a conflict', async () => {
    const userId = await insertUser();
    const created = await repo.replaceIfUnchanged(userId, fictionalCriteria(), null);
    expect(created).toBeDefined();
    expect(await repo.replaceIfUnchanged(userId, fictionalCriteria(), null)).toBeUndefined();
  });

  it('CAS replaces on a matching pin — including the ms-truncated wire round-trip of a DB-defaulted (microsecond) timestamp', async () => {
    const userId = await insertUser();
    const created = await repo.replaceIfUnchanged(userId, fictionalCriteria(), null);
    const replaced = await repo.replaceIfUnchanged(
      userId,
      { ...fictionalCriteria(), negativeSignals: ['unclear_salary'] },
      asWirePin(created!.updatedAt),
    );
    expect(replaced).toBeDefined();
    expect(replaced!.negativeSignals).toEqual(['unclear_salary']);
    expect(replaced!.updatedAt.getTime()).toBeGreaterThanOrEqual(created!.updatedAt.getTime());
  });

  it('CAS against a PRE-write pin is a conflict — a stale view never blind-overwrites', async () => {
    const userId = await insertUser();
    const created = await repo.replaceIfUnchanged(userId, fictionalCriteria(), null);
    const stalePin = asWirePin(created!.updatedAt);

    await nextMillisecond();
    const replaced = await repo.replaceIfUnchanged(
      userId,
      { ...fictionalCriteria(), negativeSignals: ['unclear_salary'] },
      stalePin,
    );
    expect(replaced).toBeDefined();

    // The first writer's pin is now stale: same pin again must conflict.
    expect(
      await repo.replaceIfUnchanged(
        userId,
        { ...fictionalCriteria(), negativeSignals: ['short_term_contract'] },
        stalePin,
      ),
    ).toBeUndefined();
    // ...and the stale attempt wrote nothing.
    const row = await repo.get(userId);
    expect(row!.negativeSignals).toEqual(['unclear_salary']);
  });

  it('CAS with a timestamp against a missing row is a conflict, not a create', async () => {
    const userId = await insertUser();
    expect(await repo.replaceIfUnchanged(userId, fictionalCriteria(), new Date())).toBeUndefined();
    expect(await repo.get(userId)).toBeUndefined();
  });
});
