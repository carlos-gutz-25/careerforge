import {
  type EvidenceStrength,
  type GapClassification,
  type PlanDraftingRunStatus,
  type PlanItemPriority,
  type PlanItemRecommendationKind,
  type PlanItemRecommendationStatus,
  type PlanItemStatus,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';
import { and, asc, desc, eq } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { evidenceLinks, fitReports, fitSubScores } from '../schema/fit.ts';
import { gaps } from '../schema/gaps.ts';
import {
  improvementPlanRuns,
  improvementPlans,
  planItemRecommendations,
  planItems,
} from '../schema/plans.ts';
import { type FitReportRow } from './fit-reports.repository.ts';

// M1-12: improvement-plan persistence + reads. A plan is an append-only
// artifact of exactly ONE fit report (pin-to-report; UNIQUE fit_report_id);
// the audit table records one row per WIRE CALL (the M1-05 law at its
// second call site); the plan row is created only from an ok,
// citation-valid run in the SAME transaction as its items.

export type ImprovementPlanRunRow = typeof improvementPlanRuns.$inferSelect;
export type ImprovementPlanRow = typeof improvementPlans.$inferSelect;
export type PlanItemRow = typeof planItems.$inferSelect;
/** M7-01b: one typed recommendation of a plan item (ADR-0017). */
export type PlanItemRecommendationRow = typeof planItemRecommendations.$inferSelect;

/** One wire call's audit row. The SERVICE maps packages/llm's LlmCallRecord
 *  into this shape (flattened usage, timestamp → createdAt) — this package's
 *  only internal dependency stays @careerforge/core. */
export interface PlanDraftingRunInsert {
  promptId: string;
  provider: string;
  model: string;
  rawResponse: unknown;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  latencyMs: number;
  attempt: number;
  /** The runner's five states — 'flagged' is never INSERTED from outside:
   *  persistDraftingOutcome derives it internally through the single policy
   *  site derivePlanRunStatus (citation validation, the M1-06 N6 pattern). */
  status: Exclude<PlanDraftingRunStatus, 'flagged'>;
  /** LlmCallRecord.timestamp (the runner's now-seam clock, F3). */
  createdAt: Date;
}

/** M7-01b: one drafted recommendation to attach to its plan item. kind is a
 *  closed vocabulary; status is NOT accepted here — every recommendation is
 *  born 'suggested' by the DB default (ADR-0017 honesty keystone). position
 *  within the item is assigned from array order by persistDraftingOutcome. */
export interface PlanItemRecommendationInsert {
  kind: PlanItemRecommendationKind;
  title: string;
  rationale: string;
  expectedBenefit: string;
}

/** position is assigned from array order by persistDraftingOutcome (model
 *  output order — the requirements.position precedent). M7-01b: an item may
 *  carry 0..N recommendations, inserted in the SAME transaction as the item;
 *  the v1 path omits the field (undefined ⇒ none — byte-behaviour unchanged). */
export interface PlanItemInsert {
  gapId: string;
  action: string;
  priority: PlanItemPriority;
  recommendations?: PlanItemRecommendationInsert[];
}

/** One plan item with its cited gap's display fields (the wire join).
 *  gapClassification is the gap's LIVE effective value at read time — it can
 *  legitimately diverge from the draft-time value after a later override
 *  (named M1-12 residual). */
export interface PlanItemWithGap {
  item: PlanItemRow;
  gapClassification: GapClassification;
  gapRequirementId: string;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
}

export interface PlanWithItems {
  plan: ImprovementPlanRow;
  /** The plan's drafting run (via drafting_run_id — the R2 run-selection
   *  contract; never latest-by-time when a plan exists). */
  run: ImprovementPlanRunRow;
  /** Canonical (position, id) order. */
  items: PlanItemWithGap[];
}

export interface DraftingPersistOutcome {
  runs: ImprovementPlanRunRow[];
  /** true iff THIS persist created the plan row. */
  planCreated: boolean;
  /**
   * true iff the plan insert hit the UNIQUE (a concurrent draft won the
   * race). The runs are still committed — both wire calls happened and both
   * are recorded (honest telemetry; the M1-05 double-POST residual, resolved
   * here by ON CONFLICT DO NOTHING instead of an aborted transaction).
   */
  conflicted: boolean;
}

/** Evidence rows for the drafting payload, keyed by requirement (via the
 *  report's sub-scores). Quotes are posting/profile-derived: untrusted
 *  payload data, never logged. */
export interface DraftingEvidenceRow {
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

/** markPlanReviewed's three-way outcome (the markReviewed mirror): the
 *  conditional update alone cannot tell a missing/foreign plan (404) from an
 *  already-reviewed one (409), and the service must. */
export type PlanReviewOutcome =
  | { kind: 'reviewed'; plan: ImprovementPlanRow }
  | { kind: 'already_reviewed' }
  | { kind: 'not_found' };

/**
 * The single policy site for the post-hoc 'flagged' status (M1-06 N6
 * pattern): an ok run whose parsed output cited a gap ref that was never
 * sent is flagged AT INSERT TIME — the drafting analog of ADR-0006 layer 4.
 * Non-ok statuses pass through untouched (there is no output to validate).
 */
export function derivePlanRunStatus(
  status: Exclude<PlanDraftingRunStatus, 'flagged'>,
  citationFailed: boolean,
): PlanDraftingRunStatus {
  return status === 'ok' && citationFailed ? 'flagged' : status;
}

export interface ImprovementPlansRepository {
  /** The report row by id — user-scoped anchor read for the plan module
   *  (review-status gate + 404); missing and foreign-owned are one outcome. */
  findReportById(userId: string, reportId: string): Promise<FitReportRow | undefined>;

  /** Evidence links of the report's sub-scores, for the drafting payload
   *  (requirement-keyed; strength + both quotes). */
  findEvidenceForReport(userId: string, reportId: string): Promise<DraftingEvidenceRow[]>;

  /**
   * ONE transaction for a whole drafting outcome (the persistExtraction
   * precedent): every wire-call audit row always; the plan row + its
   * complete item set ONLY when `items` is provided — the caller's contract
   * is that `items` implies the final run is ok and citation-valid. The
   * final run's stored status passes through derivePlanRunStatus
   * (citationFailed=true ⇒ 'flagged', no plan row). The plan insert is
   * ON CONFLICT DO NOTHING on fit_report_id: a lost concurrent race commits
   * the runs and reports `conflicted` instead of aborting the transaction.
   * APPEND-ONLY: nothing mutates; item position = array order.
   */
  persistDraftingOutcome(
    userId: string,
    fitReportId: string,
    runs: PlanDraftingRunInsert[],
    citationFailed: boolean,
    items: PlanItemInsert[] | undefined,
  ): Promise<DraftingPersistOutcome>;

  /** The report's plan with its drafting run and joined items, or undefined
   *  when no plan exists (report existence is findReportById's business). */
  findPlanForReport(userId: string, fitReportId: string): Promise<PlanWithItems | undefined>;

  /** Latest drafting run for the report by (created_at, id) — the GET's
   *  failure-display read, used ONLY when no plan exists (R2). */
  findLatestRunForReport(
    userId: string,
    fitReportId: string,
  ): Promise<ImprovementPlanRunRow | undefined>;

  /**
   * The one-shot draft→reviewed transition (the markReviewed mirror):
   * conditional UPDATE pinned to review_status='draft', capturing notes at
   * that moment; on zero rows a user-scoped re-read disambiguates
   * already_reviewed from not_found.
   */
  markPlanReviewed(
    userId: string,
    planId: string,
    notes: string | null,
  ): Promise<PlanReviewOutcome>;

  /**
   * FULL REPLACEMENT of the two mutable fields (the overrideGap A2
   * semantics, re-editable by design — no CAS). action/gap_id/position are
   * immutable by omission: this UPDATE can only ever touch status +
   * priority. undefined on missing/foreign (one 404).
   */
  updatePlanItem(
    userId: string,
    itemId: string,
    status: PlanItemStatus,
    priority: PlanItemPriority,
  ): Promise<PlanItemWithGap | undefined>;

  /**
   * M7-01b: all recommendations of a plan's items, user-scoped, in canonical
   * (item position, recommendation position, id) order — M7-03's GET
   * projection groups them by plan_item_id. Born unused until M7-03.
   */
  findRecommendationsForPlan(
    userId: string,
    improvementPlanId: string,
  ): Promise<PlanItemRecommendationRow[]>;

  /**
   * M7-01b: the status-ONLY update (ADR-0017 — status is the only mutable
   * field; kind/title/rationale/expected_benefit are the model's cited draft,
   * immutable by omission, the updatePlanItem idiom). User-scoped; undefined
   * on missing/foreign (one 404). The transition policy (is `adopted`
   * one-way? may a user un-dismiss?) is M7-03/M7-04's — this is a plain setter
   * to any of the three lifecycle values. Born unused until M7-03.
   */
  updatePlanItemRecommendationStatus(
    userId: string,
    recommendationId: string,
    status: PlanItemRecommendationStatus,
  ): Promise<PlanItemRecommendationRow | undefined>;
}

export function createImprovementPlansRepository(db: Db): ImprovementPlansRepository {
  const itemJoinColumns = {
    item: planItems,
    gapClassification: gaps.classification,
    gapRequirementId: gaps.requirementId,
    requirementText: requirements.text,
    requirementKind: requirements.kind,
    requirementCategory: requirements.category,
  };

  return {
    async findReportById(userId, reportId) {
      const [report] = await db
        .select()
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.id, reportId)))
        .limit(1);
      return report;
    },

    async findEvidenceForReport(userId, reportId) {
      return db
        .select({
          requirementId: evidenceLinks.requirementId,
          strength: evidenceLinks.strength,
          postingQuote: evidenceLinks.postingQuote,
          profileQuote: evidenceLinks.profileQuote,
        })
        .from(evidenceLinks)
        .innerJoin(fitSubScores, eq(fitSubScores.id, evidenceLinks.fitSubScoreId))
        .where(and(eq(evidenceLinks.userId, userId), eq(fitSubScores.fitReportId, reportId)))
        .orderBy(asc(evidenceLinks.createdAt), asc(evidenceLinks.id));
    },

    async persistDraftingOutcome(userId, fitReportId, runs, citationFailed, items) {
      if (runs.length === 0) throw new Error('persistDraftingOutcome requires at least one run');
      const finalIndex = runs.length - 1;

      return db.transaction(async (tx) => {
        const runRows: ImprovementPlanRunRow[] = [];
        for (const [index, run] of runs.entries()) {
          const [runRow] = await tx
            .insert(improvementPlanRuns)
            .values({
              userId,
              fitReportId,
              promptId: run.promptId,
              provider: run.provider,
              model: run.model,
              rawResponse: run.rawResponse,
              inputTokens: run.inputTokens,
              outputTokens: run.outputTokens,
              cacheReadInputTokens: run.cacheReadInputTokens,
              cacheCreationInputTokens: run.cacheCreationInputTokens,
              latencyMs: run.latencyMs,
              attempt: run.attempt,
              status:
                index === finalIndex ? derivePlanRunStatus(run.status, citationFailed) : run.status,
              createdAt: run.createdAt,
            })
            .returning();
          if (!runRow) throw new Error('improvement_plan_runs insert returned no rows');
          runRows.push(runRow);
        }

        const finalRun = runRows[finalIndex];
        if (!finalRun) throw new Error('unreachable: runs is non-empty');

        let planCreated = false;
        let conflicted = false;
        if (items !== undefined) {
          if (finalRun.status !== 'ok') {
            throw new Error('plan items require an ok, citation-valid final run');
          }
          const [planRow] = await tx
            .insert(improvementPlans)
            .values({ userId, fitReportId, draftingRunId: finalRun.id })
            .onConflictDoNothing({ target: improvementPlans.fitReportId })
            .returning();
          if (planRow) {
            planCreated = true;
            if (items.length > 0) {
              // Insert items with .returning() so each recommendation resolves
              // to its just-inserted item id. Match returned rows to their
              // source item by `position` (= array index we assigned) rather
              // than trusting returning() order — deterministic either way.
              const insertedItems = await tx
                .insert(planItems)
                .values(
                  items.map((item, position) => ({
                    userId,
                    improvementPlanId: planRow.id,
                    gapId: item.gapId,
                    action: item.action,
                    priority: item.priority,
                    position,
                  })),
                )
                .returning({ id: planItems.id, position: planItems.position });
              const itemIdByPosition = new Map(insertedItems.map((row) => [row.position, row.id]));

              // M7-01b: recommendations follow items in the SAME transaction —
              // a citation-failed run reaches neither the plan nor items nor
              // recommendations (the flag-write-nothing discipline extends
              // coherently). status is omitted ⇒ born 'suggested' (DB default).
              const recommendationValues = items.flatMap((item, position) => {
                const planItemId = itemIdByPosition.get(position);
                if (planItemId === undefined) {
                  throw new Error('unreachable: plan item insert dropped a position');
                }
                return (item.recommendations ?? []).map((rec, recPosition) => ({
                  userId,
                  planItemId,
                  kind: rec.kind,
                  title: rec.title,
                  rationale: rec.rationale,
                  expectedBenefit: rec.expectedBenefit,
                  position: recPosition,
                }));
              });
              if (recommendationValues.length > 0) {
                await tx.insert(planItemRecommendations).values(recommendationValues);
              }
            }
          } else {
            conflicted = true;
          }
        }

        return { runs: runRows, planCreated, conflicted };
      });
    },

    async findPlanForReport(userId, fitReportId) {
      const [planRow] = await db
        .select()
        .from(improvementPlans)
        .where(
          and(eq(improvementPlans.userId, userId), eq(improvementPlans.fitReportId, fitReportId)),
        )
        .limit(1);
      if (!planRow) return undefined;

      const [runRow] = await db
        .select()
        .from(improvementPlanRuns)
        .where(eq(improvementPlanRuns.id, planRow.draftingRunId))
        .limit(1);
      if (!runRow) throw new Error('improvement plan has no drafting run (FK violated?)');

      const items = await db
        .select(itemJoinColumns)
        .from(planItems)
        .innerJoin(gaps, eq(gaps.id, planItems.gapId))
        .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
        .where(eq(planItems.improvementPlanId, planRow.id))
        .orderBy(asc(planItems.position), asc(planItems.id));

      return { plan: planRow, run: runRow, items };
    },

    async findLatestRunForReport(userId, fitReportId) {
      const [runRow] = await db
        .select()
        .from(improvementPlanRuns)
        .where(
          and(
            eq(improvementPlanRuns.userId, userId),
            eq(improvementPlanRuns.fitReportId, fitReportId),
          ),
        )
        .orderBy(desc(improvementPlanRuns.createdAt), desc(improvementPlanRuns.id))
        .limit(1);
      return runRow;
    },

    async markPlanReviewed(userId, planId, notes) {
      const [updated] = await db
        .update(improvementPlans)
        .set({ reviewStatus: 'reviewed', notes })
        .where(
          and(
            eq(improvementPlans.userId, userId),
            eq(improvementPlans.id, planId),
            eq(improvementPlans.reviewStatus, 'draft'),
          ),
        )
        .returning();
      if (updated) return { kind: 'reviewed', plan: updated };

      const [existing] = await db
        .select({ id: improvementPlans.id })
        .from(improvementPlans)
        .where(and(eq(improvementPlans.userId, userId), eq(improvementPlans.id, planId)))
        .limit(1);
      return existing ? { kind: 'already_reviewed' } : { kind: 'not_found' };
    },

    async updatePlanItem(userId, itemId, status, priority) {
      const [updated] = await db
        .update(planItems)
        .set({ status, priority })
        .where(and(eq(planItems.userId, userId), eq(planItems.id, itemId)))
        .returning();
      if (!updated) return undefined;

      const [joined] = await db
        .select(itemJoinColumns)
        .from(planItems)
        .innerJoin(gaps, eq(gaps.id, planItems.gapId))
        .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
        .where(eq(planItems.id, updated.id))
        .limit(1);
      return joined;
    },

    async findRecommendationsForPlan(userId, improvementPlanId) {
      return db
        .select({
          id: planItemRecommendations.id,
          userId: planItemRecommendations.userId,
          planItemId: planItemRecommendations.planItemId,
          kind: planItemRecommendations.kind,
          status: planItemRecommendations.status,
          title: planItemRecommendations.title,
          rationale: planItemRecommendations.rationale,
          expectedBenefit: planItemRecommendations.expectedBenefit,
          position: planItemRecommendations.position,
          createdAt: planItemRecommendations.createdAt,
          updatedAt: planItemRecommendations.updatedAt,
        })
        .from(planItemRecommendations)
        .innerJoin(planItems, eq(planItems.id, planItemRecommendations.planItemId))
        .where(
          and(
            eq(planItemRecommendations.userId, userId),
            eq(planItems.improvementPlanId, improvementPlanId),
          ),
        )
        .orderBy(
          asc(planItems.position),
          asc(planItemRecommendations.position),
          asc(planItemRecommendations.id),
        );
    },

    async updatePlanItemRecommendationStatus(userId, recommendationId, status) {
      const [updated] = await db
        .update(planItemRecommendations)
        .set({ status })
        .where(
          and(
            eq(planItemRecommendations.userId, userId),
            eq(planItemRecommendations.id, recommendationId),
          ),
        )
        .returning();
      return updated;
    },
  };
}
