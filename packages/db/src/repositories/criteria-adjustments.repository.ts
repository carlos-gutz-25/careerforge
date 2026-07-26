import {
  type CriteriaAdjustmentEvidence,
  type CriteriaAdjustmentKind,
  type SearchCriteriaData,
  type SignalCategory,
} from '@careerforge/core';
import { and, desc, eq } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { criteriaAdjustments } from '../schema/criteria-adjustments.ts';
import { searchCriteria } from '../schema/profile.ts';
import { DB_NOW, updatedAtMatches, type SearchCriteriaRow } from './criteria.repository.ts';

// M4-02: criteria_adjustments persistence (Outcomes → matching feedback). The
// ONLY module allowed SQL for this table (routes -> services -> repositories).
// Every query is user-scoped (ADR-0007). The confirm write is a single
// transaction: the search_criteria compare-and-swap AND the audit insert commit
// together or not at all — a rejected CAS writes ZERO audit rows (the invariant a
// repo test pins), so the trail never records an adjustment that was not applied.

export type CriteriaAdjustmentRow = typeof criteriaAdjustments.$inferSelect;

/** The full confirm payload: the target + the frozen evidence + the criteria
 *  documents before/after the removal (the service computed `after` via the ONE
 *  applyCriteriaAdjustment definition). */
export interface ConfirmAdjustmentInput {
  kind: CriteriaAdjustmentKind;
  category: SignalCategory | null;
  slug: string;
  evidence: CriteriaAdjustmentEvidence;
  before: SearchCriteriaData;
  after: SearchCriteriaData;
}

/** `conflict` = the search_criteria CAS matched zero rows (the row changed or
 *  vanished between the caller's read and this write) — the service maps it to a
 *  409, and NO audit row was written. */
export type ConfirmAdjustmentResult =
  | { status: 'conflict' }
  | { status: 'ok'; adjustment: CriteriaAdjustmentRow; criteria: SearchCriteriaRow };

export interface CriteriaAdjustmentsRepository {
  /**
   * Apply a confirmed adjustment in ONE transaction: the search_criteria
   * compare-and-swap (pinned to `expectedUpdatedAt`, reusing the PUT /criteria
   * predicate + DB clock — one CAS definition) THEN the audit insert. The CAS
   * runs first: zero rows → return `conflict` before any insert, so the
   * transaction commits with nothing written. `expectedUpdatedAt` is the pin the
   * caller last saw (GET /criteria-suggestions' `criteriaUpdatedAt`).
   */
  confirmAdjustment(
    userId: string,
    input: ConfirmAdjustmentInput,
    expectedUpdatedAt: Date,
  ): Promise<ConfirmAdjustmentResult>;

  /** The append-only audit list, newest first (created_at desc, id tiebreak). */
  listForUser(userId: string): Promise<CriteriaAdjustmentRow[]>;
}

export function createCriteriaAdjustmentsRepository(db: Db): CriteriaAdjustmentsRepository {
  return {
    confirmAdjustment(userId, input, expectedUpdatedAt) {
      return db.transaction(async (tx) => {
        // CAS FIRST (the transitionStage pattern): the conditional update is the
        // gate. Zero rows → conflict, and we return having inserted nothing.
        const [criteria] = await tx
          .update(searchCriteria)
          .set({
            hardFilters: input.after.hardFilters,
            positiveSignals: input.after.positiveSignals,
            negativeSignals: input.after.negativeSignals,
            forceLowestPriority: input.after.forceLowestPriority,
            compBounds: input.after.compBounds,
            updatedAt: DB_NOW,
          })
          .where(and(eq(searchCriteria.userId, userId), updatedAtMatches(expectedUpdatedAt)))
          .returning();
        if (!criteria) return { status: 'conflict' };

        const [adjustment] = await tx
          .insert(criteriaAdjustments)
          .values({
            userId,
            kind: input.kind,
            category: input.category,
            slug: input.slug,
            evidence: input.evidence,
            criteriaBefore: input.before,
            criteriaAfter: input.after,
          })
          .returning();
        if (!adjustment) throw new Error('criteria_adjustments insert returned no row');
        return { status: 'ok', adjustment, criteria };
      });
    },

    async listForUser(userId) {
      return db
        .select()
        .from(criteriaAdjustments)
        .where(eq(criteriaAdjustments.userId, userId))
        .orderBy(desc(criteriaAdjustments.createdAt), desc(criteriaAdjustments.id));
    },
  };
}
