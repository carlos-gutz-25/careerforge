import { and, eq, sql } from 'drizzle-orm';
import { type SearchCriteriaData } from '@careerforge/core';

import { type Db } from '../client.ts';
import { searchCriteria } from '../schema/profile.ts';

export type SearchCriteriaRow = typeof searchCriteria.$inferSelect;

export interface SearchCriteriaRepository {
  /** The user's single criteria row, or undefined before the first import/PUT. */
  get(userId: string): Promise<SearchCriteriaRow | undefined>;
  /**
   * Unconditional create-or-replace — the IMPORTER's write, used only after
   * the service-level collision gate has decided an overwrite is allowed
   * (no row / identical / --force). Bumps updated_at explicitly: insert
   * builders don't run $onUpdate, and the CAS below compares against it.
   */
  upsert(userId: string, data: SearchCriteriaData): Promise<SearchCriteriaRow>;
  /**
   * PUT /criteria's compare-and-swap (postings-transition analog — never a
   * blind overwrite). `expectedUpdatedAt: null` = create; an existing row
   * makes it a conflict. A timestamp = replace pinned to the updated_at the
   * caller last saw; zero rows = the row changed (or vanished) concurrently.
   * Returns the written row, or undefined on conflict — the service maps
   * that to 409.
   */
  replaceIfUnchanged(
    userId: string,
    data: SearchCriteriaData,
    expectedUpdatedAt: Date | null,
  ): Promise<SearchCriteriaRow | undefined>;
}

/**
 * CAS comparison at millisecond precision: rows created via the DB default
 * carry Postgres now() (microseconds), while the wire ISO string — the only
 * place expectedUpdatedAt can come from — carries milliseconds. Truncating
 * the stored value makes round-tripped timestamps compare equal without
 * weakening the pin (a lost update would need two writes inside the same
 * millisecond AND a stale reader — the write paths here are one user's).
 */
const updatedAtMatches = (expected: Date) =>
  sql`date_trunc('milliseconds', ${searchCriteria.updatedAt}) = ${expected}`;

/**
 * ONE clock source for the CAS column: every write path here stamps
 * updated_at with Postgres now() (the insert path via the column default,
 * the replace paths via this explicit set — which also overrides $onUpdate's
 * host-clock value). Mixing clocks broke bump ordering in practice: the
 * dockerized (colima VM) Postgres clock and the host Node clock disagreed by
 * ~80ms, making an app-clock "bump" travel backwards relative to a
 * DB-defaulted create.
 */
const DB_NOW = sql`now()`;

export function createSearchCriteriaRepository(db: Db): SearchCriteriaRepository {
  return {
    async get(userId) {
      const rows = await db.select().from(searchCriteria).where(eq(searchCriteria.userId, userId));
      return rows[0];
    },

    async upsert(userId, data) {
      const [row] = await db
        .insert(searchCriteria)
        .values({ userId, ...data })
        .onConflictDoUpdate({
          target: searchCriteria.userId,
          set: { ...data, updatedAt: DB_NOW },
        })
        .returning();
      if (!row) throw new Error('search_criteria upsert returned no row');
      return row;
    },

    async replaceIfUnchanged(userId, data, expectedUpdatedAt) {
      if (expectedUpdatedAt === null) {
        // Create: on conflict DO NOTHING returns zero rows, surfacing the
        // already-exists race as the same conflict signal.
        const rows = await db
          .insert(searchCriteria)
          .values({ userId, ...data })
          .onConflictDoNothing({ target: searchCriteria.userId })
          .returning();
        return rows[0];
      }
      // Replace pinned to the caller's view; updated_at bumps on the DB clock.
      const rows = await db
        .update(searchCriteria)
        .set({ ...data, updatedAt: DB_NOW })
        .where(and(eq(searchCriteria.userId, userId), updatedAtMatches(expectedUpdatedAt)))
        .returning();
      return rows[0];
    },
  };
}
