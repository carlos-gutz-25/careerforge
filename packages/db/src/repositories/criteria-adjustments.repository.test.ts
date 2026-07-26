import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type CriteriaAdjustmentEvidence, type SearchCriteriaData } from '@careerforge/core';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { createCriteriaAdjustmentsRepository } from './criteria-adjustments.repository.ts';
import { createSearchCriteriaRepository } from './criteria.repository.ts';

// Integration coverage for the M4-02 confirm write (Outcomes → matching
// feedback): the search_criteria CAS + the audit insert in ONE transaction. A
// rejected CAS must write ZERO audit rows. Fixture values are fictional
// (docs/profile.example/ vocabulary).
const handle = createTestDb();
const { pool, db } = handle;
const repo = createCriteriaAdjustmentsRepository(db);
const criteriaRepo = createSearchCriteriaRepository(db);

async function insertUser(email = 'alex.rivera.example@example.com'): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into users (email, password_hash) values ($1, 'fake-hash') returning id`,
    [email],
  );
  return result.rows[0]!.id;
}

const criteriaWith = (negativeSignals: string[]): SearchCriteriaData => ({
  hardFilters: { seniority: ['entry_level'] },
  positiveSignals: {
    role: ['senior_software_engineer'],
    technologies: ['typescript', 'go'],
    problem_domains: ['api_platforms'],
    work_arrangement: ['remote_us'],
    scope: ['architecture'],
  },
  negativeSignals,
  forceLowestPriority: { industry: ['multilevel_marketing'] },
  compBounds: { currency: 'usd', base_preferred_min: 100_000, base_preferred_max: 150_000 },
});

const EVIDENCE: CriteriaAdjustmentEvidence = {
  matched: { total: 4, progressed: 3 },
  unmatched: { total: 4, progressed: 1 },
  matchedPostings: [],
};

const asWirePin = (updatedAt: Date) => new Date(updatedAt.toISOString());
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => truncateAllTables(handle));
afterAll(() => pool.end());

describe('criteria adjustments repository (integration)', () => {
  it('confirms in one tx: criteria swapped, pin advanced, audit row written', async () => {
    const userId = await insertUser();
    const before = criteriaWith(['frontend_only', 'legacy_php']);
    const seeded = await criteriaRepo.upsert(userId, before);
    const after = criteriaWith(['frontend_only']); // legacy_php removed

    await nextMillisecond();
    const result = await repo.confirmAdjustment(
      userId,
      {
        kind: 'remove_negative_signal',
        category: null,
        slug: 'legacy_php',
        evidence: EVIDENCE,
        before,
        after,
      },
      asWirePin(seeded.updatedAt),
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.criteria.negativeSignals).toEqual(['frontend_only']);
    expect(result.criteria.updatedAt.getTime()).toBeGreaterThan(seeded.updatedAt.getTime());
    expect(result.adjustment.slug).toBe('legacy_php');
    expect(result.adjustment.category).toBeNull();
    expect(result.adjustment.criteriaBefore.negativeSignals).toEqual([
      'frontend_only',
      'legacy_php',
    ]);
    expect(result.adjustment.criteriaAfter.negativeSignals).toEqual(['frontend_only']);

    // The persisted criteria row reflects the swap.
    const persisted = await criteriaRepo.get(userId);
    expect(persisted!.negativeSignals).toEqual(['frontend_only']);
    // …and exactly one audit row exists.
    expect(await repo.listForUser(userId)).toHaveLength(1);
  });

  it('a stale pin conflicts AND writes zero audit rows (atomic rollback)', async () => {
    const userId = await insertUser();
    const before = criteriaWith(['frontend_only', 'legacy_php']);
    const seeded = await criteriaRepo.upsert(userId, before);
    const stalePin = asWirePin(seeded.updatedAt);

    // Someone else bumps the criteria; the pin is now stale.
    await nextMillisecond();
    await criteriaRepo.upsert(userId, criteriaWith(['frontend_only', 'legacy_php', 'on_call']));

    const result = await repo.confirmAdjustment(
      userId,
      {
        kind: 'remove_negative_signal',
        category: null,
        slug: 'legacy_php',
        evidence: EVIDENCE,
        before,
        after: criteriaWith(['frontend_only']),
      },
      stalePin,
    );
    expect(result.status).toBe('conflict');
    // The criteria row is untouched by the failed confirm…
    const persisted = await criteriaRepo.get(userId);
    expect(persisted!.negativeSignals).toEqual(['frontend_only', 'legacy_php', 'on_call']);
    // …and NO audit row was written (the transaction rolled back).
    expect(await repo.listForUser(userId)).toEqual([]);
  });

  it('listForUser returns the audit trail newest first', async () => {
    const userId = await insertUser();
    let current = await criteriaRepo.upsert(userId, criteriaWith(['frontend_only', 'legacy_php']));

    await nextMillisecond();
    const first = await repo.confirmAdjustment(
      userId,
      {
        kind: 'remove_negative_signal',
        category: null,
        slug: 'legacy_php',
        evidence: EVIDENCE,
        before: criteriaWith(['frontend_only', 'legacy_php']),
        after: criteriaWith(['frontend_only']),
      },
      asWirePin(current.updatedAt),
    );
    if (first.status !== 'ok') throw new Error('first confirm should succeed');
    current = first.criteria;

    await nextMillisecond();
    const second = await repo.confirmAdjustment(
      userId,
      {
        kind: 'remove_positive_signal',
        category: 'technologies',
        slug: 'go',
        evidence: EVIDENCE,
        before: { ...criteriaWith(['frontend_only']) },
        after: {
          ...criteriaWith(['frontend_only']),
          positiveSignals: {
            ...criteriaWith(['frontend_only']).positiveSignals,
            technologies: ['typescript'],
          },
        },
      },
      asWirePin(current.updatedAt),
    );
    if (second.status !== 'ok') throw new Error('second confirm should succeed');

    const list = await repo.listForUser(userId);
    expect(list.map((row) => row.slug)).toEqual(['go', 'legacy_php']);
  });
});
