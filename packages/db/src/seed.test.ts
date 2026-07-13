import { afterAll, beforeEach, describe, expect, it } from 'vitest';

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

  it('is idempotent — running twice yields identical row counts (gate V3)', async () => {
    const first = await seed(handle.db);
    const countsAfterFirst = await rowCounts();
    const second = await seed(handle.db);
    expect(second.userId).toBe(first.userId);
    expect(await rowCounts()).toEqual(countsAfterFirst);
  });
});
