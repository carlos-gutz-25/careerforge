import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { searchCriteriaSchema } from '@careerforge/core';

import { seed, SEED_USER_EMAIL } from './seed.ts';
import { createTestDb, truncateAllTables } from './test/db-test-utils.ts';

const handle = createTestDb();

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

async function rowCounts() {
  const { rows } = await handle.pool.query<Record<string, string>>(
    `select
       (select count(*) from users) as users,
       (select count(*) from profile_skills) as skills,
       (select count(*) from profile_experiences) as experiences,
       (select count(*) from profile_projects) as projects,
       (select count(*) from search_criteria) as criteria`,
  );
  return rows[0];
}

describe('seed (integration)', () => {
  it('seeds the fictional example profile', async () => {
    const summary = await seed(handle.db);
    expect(summary).toMatchObject({ skills: 8, experiences: 3, projects: 3 });
    const user = await handle.pool.query<{ email: string }>(`select email from users`);
    expect(user.rows).toEqual([{ email: SEED_USER_EMAIL }]);
  });

  it('seeds CANONICAL criteria shapes — the row passes searchCriteriaSchema (M1-08)', async () => {
    // Column defaults are structural placeholders only; the seed writes real
    // payloads, so the seeded row must be canonically valid end to end.
    await seed(handle.db);
    const { rows } = await handle.pool.query<Record<string, unknown>>(
      `select hard_filters, positive_signals, negative_signals,
              force_lowest_priority, comp_bounds
         from search_criteria`,
    );
    expect(rows).toHaveLength(1);
    const parsed = searchCriteriaSchema.safeParse({
      hardFilters: rows[0]!.hard_filters,
      positiveSignals: rows[0]!.positive_signals,
      negativeSignals: rows[0]!.negative_signals,
      forceLowestPriority: rows[0]!.force_lowest_priority,
      compBounds: rows[0]!.comp_bounds,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('is idempotent — running twice yields identical row counts (gate V3)', async () => {
    const first = await seed(handle.db);
    const countsAfterFirst = await rowCounts();
    const second = await seed(handle.db);
    expect(second.userId).toBe(first.userId);
    expect(await rowCounts()).toEqual(countsAfterFirst);
  });
});
