import {
  type EvidenceStrength,
  type GapClassification,
  type PlanDraftingRunStatus,
  type PlanItemPriority,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { evidenceLinks, fitSubScores } from '../schema/fit.ts';
import { gaps } from '../schema/gaps.ts';
import { learningPlanGaps, learningPlanRuns, learningPlans } from '../schema/learning.ts';
import { derivePlanRunStatus } from './improvement-plans.repository.ts';

// M3-01: learning-plan persistence + reads. A learning plan is an append-only
// artifact drafted over a USER-SELECTED gap set spanning MULTIPLE postings —
// FREE-CREATE (plural by design; no UNIQUE, no pin-to-report, ADR-0013). The
// audit table records one row per WIRE CALL (the M1-05 law at its third call
// site); the plan row + its complete cited-gap set are created only from an
// ok, citation-valid run in the SAME transaction. The post-hoc 'flagged'
// status reuses the improvement-plan policy site derivePlanRunStatus.

export type LearningPlanRunRow = typeof learningPlanRuns.$inferSelect;
export type LearningPlanRow = typeof learningPlans.$inferSelect;
export type LearningPlanGapRow = typeof learningPlanGaps.$inferSelect;

/** One wire call's audit row (the PlanDraftingRunInsert twin, minus the
 *  fit_report anchor a learning plan does not have). The SERVICE maps
 *  packages/llm's LlmCallRecord into this shape. */
export interface LearningPlanRunInsert {
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
  /** The runner's five states — 'flagged' is derived internally by
   *  persistDraftingOutcome (citation validation), never inserted from
   *  outside. */
  status: Exclude<PlanDraftingRunStatus, 'flagged'>;
  createdAt: Date;
}

/** One cited gap to persist; position is assigned from array order (the
 *  drafted order — recurring gaps first). */
export interface LearningPlanGapInsert {
  gapId: string;
  focus: string;
  priority: PlanItemPriority;
}

/** The plan payload for a successful draft: the model-drafted title plus the
 *  cited-gap set. Present ONLY when the final run is ok + citation-valid. */
export interface LearningPlanInsert {
  title: string;
  gaps: LearningPlanGapInsert[];
}

/** One cited gap with its gap's LIVE display fields (the wire join).
 *  gapClassification can legitimately diverge from the draft-time value after
 *  a later override (the M1-12 residual). */
export interface LearningPlanGapWithGap {
  row: LearningPlanGapRow;
  gapClassification: GapClassification;
  gapRequirementId: string;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
}

export interface LearningPlanWithGaps {
  plan: LearningPlanRow;
  /** The plan's OWN drafting run (via drafting_run_id — never latest-by-time;
   *  there is no report to hang a latest-by-time failure display on). */
  run: LearningPlanRunRow;
  /** Canonical (position, id) order. */
  gaps: LearningPlanGapWithGap[];
}

/** List row for GET /learning-plans (meta only; newest first). */
export interface LearningPlanSummaryRow {
  id: string;
  title: string;
  reviewStatus: LearningPlanRow['reviewStatus'];
  gapCount: number;
  createdAt: Date;
}

export interface LearningDraftingPersistOutcome {
  runs: LearningPlanRunRow[];
  /** true iff THIS persist created the plan row. Free-create has no UNIQUE, so
   *  there is no 'conflicted' outcome — a plan is written whenever `plan` is
   *  provided (an ok, citation-valid final run). */
  planCreated: boolean;
  /** The created plan's id when planCreated, else undefined — the caller reads
   *  it back by this id (no fit_report anchor to re-read by). */
  planId: string | undefined;
}

/** Evidence rows for the drafting payload, keyed by (fit_report, requirement)
 *  so a gap only ever sees evidence from ITS OWN report (no cross-report bleed
 *  when a selection spans re-scores of one posting). Quotes are
 *  posting/profile-derived: untrusted payload data, never logged. */
export interface LearningEvidenceRow {
  fitReportId: string;
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

/** markLearningPlanReviewed's three-way outcome (the markPlanReviewed mirror):
 *  the conditional update alone cannot tell a missing/foreign plan (404) from
 *  an already-reviewed one (409). */
export type LearningPlanReviewOutcome =
  | { kind: 'reviewed'; plan: LearningPlanRow }
  | { kind: 'already_reviewed' }
  | { kind: 'not_found' };

export interface LearningPlansRepository {
  /** Evidence links for the given reports, keyed by (fit_report, requirement),
   *  for the drafting payload. The service passes the DISTINCT report ids of
   *  the selected gaps. */
  findEvidenceForReports(
    userId: string,
    reportIds: readonly string[],
  ): Promise<LearningEvidenceRow[]>;

  /**
   * ONE transaction for a whole drafting outcome (the persistDraftingOutcome
   * precedent): every wire-call audit row always; the plan row + its complete
   * cited-gap set ONLY when `plan` is provided — the caller's contract is that
   * `plan` implies the final run is ok and citation-valid. The final run's
   * stored status passes through derivePlanRunStatus (citationFailed=true ⇒
   * 'flagged', no plan row). FREE-CREATE: a plain insert, no ON CONFLICT — a
   * learning plan is plural by design. APPEND-ONLY: nothing mutates; cited-gap
   * position = array order.
   */
  persistDraftingOutcome(
    userId: string,
    runs: LearningPlanRunInsert[],
    citationFailed: boolean,
    plan: LearningPlanInsert | undefined,
  ): Promise<LearningDraftingPersistOutcome>;

  /** The plan with its drafting run and joined cited gaps, or undefined when
   *  missing/foreign (one 404 outcome). */
  findLearningPlan(userId: string, planId: string): Promise<LearningPlanWithGaps | undefined>;

  /** All of the user's learning plans, newest first, meta only (gapCount is a
   *  grouped count of the cited-gap rows). */
  listLearningPlans(userId: string): Promise<LearningPlanSummaryRow[]>;

  /**
   * The one-shot draft→reviewed transition (the markPlanReviewed mirror):
   * conditional UPDATE pinned to review_status='draft', capturing notes at
   * that moment; on zero rows a user-scoped re-read disambiguates
   * already_reviewed from not_found.
   */
  markLearningPlanReviewed(
    userId: string,
    planId: string,
    notes: string | null,
  ): Promise<LearningPlanReviewOutcome>;
}

export function createLearningPlansRepository(db: Db): LearningPlansRepository {
  const gapJoinColumns = {
    row: learningPlanGaps,
    gapClassification: gaps.classification,
    gapRequirementId: gaps.requirementId,
    requirementText: requirements.text,
    requirementKind: requirements.kind,
    requirementCategory: requirements.category,
  };

  return {
    async findEvidenceForReports(userId, reportIds) {
      if (reportIds.length === 0) return [];
      return db
        .select({
          fitReportId: fitSubScores.fitReportId,
          requirementId: evidenceLinks.requirementId,
          strength: evidenceLinks.strength,
          postingQuote: evidenceLinks.postingQuote,
          profileQuote: evidenceLinks.profileQuote,
        })
        .from(evidenceLinks)
        .innerJoin(fitSubScores, eq(fitSubScores.id, evidenceLinks.fitSubScoreId))
        .where(
          and(eq(evidenceLinks.userId, userId), inArray(fitSubScores.fitReportId, [...reportIds])),
        )
        .orderBy(asc(evidenceLinks.createdAt), asc(evidenceLinks.id));
    },

    async persistDraftingOutcome(userId, runs, citationFailed, plan) {
      if (runs.length === 0) throw new Error('persistDraftingOutcome requires at least one run');
      const finalIndex = runs.length - 1;

      return db.transaction(async (tx) => {
        const runRows: LearningPlanRunRow[] = [];
        for (const [index, run] of runs.entries()) {
          const [runRow] = await tx
            .insert(learningPlanRuns)
            .values({
              userId,
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
          if (!runRow) throw new Error('learning_plan_runs insert returned no rows');
          runRows.push(runRow);
        }

        const finalRun = runRows[finalIndex];
        if (!finalRun) throw new Error('unreachable: runs is non-empty');

        let planCreated = false;
        let planId: string | undefined;
        if (plan !== undefined) {
          if (finalRun.status !== 'ok') {
            throw new Error('learning plan requires an ok, citation-valid final run');
          }
          const [planRow] = await tx
            .insert(learningPlans)
            .values({ userId, title: plan.title, draftingRunId: finalRun.id })
            .returning();
          if (!planRow) throw new Error('learning_plans insert returned no rows');
          planCreated = true;
          planId = planRow.id;
          if (plan.gaps.length > 0) {
            await tx.insert(learningPlanGaps).values(
              plan.gaps.map((cited, position) => ({
                userId,
                learningPlanId: planRow.id,
                gapId: cited.gapId,
                focus: cited.focus,
                priority: cited.priority,
                position,
              })),
            );
          }
        }

        return { runs: runRows, planCreated, planId };
      });
    },

    async findLearningPlan(userId, planId) {
      const [planRow] = await db
        .select()
        .from(learningPlans)
        .where(and(eq(learningPlans.userId, userId), eq(learningPlans.id, planId)))
        .limit(1);
      if (!planRow) return undefined;

      const [runRow] = await db
        .select()
        .from(learningPlanRuns)
        .where(eq(learningPlanRuns.id, planRow.draftingRunId))
        .limit(1);
      if (!runRow) throw new Error('learning plan has no drafting run (FK violated?)');

      const gapRows = await db
        .select(gapJoinColumns)
        .from(learningPlanGaps)
        .innerJoin(gaps, eq(gaps.id, learningPlanGaps.gapId))
        .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
        .where(eq(learningPlanGaps.learningPlanId, planRow.id))
        .orderBy(asc(learningPlanGaps.position), asc(learningPlanGaps.id));

      return { plan: planRow, run: runRow, gaps: gapRows };
    },

    async listLearningPlans(userId) {
      return db
        .select({
          id: learningPlans.id,
          title: learningPlans.title,
          reviewStatus: learningPlans.reviewStatus,
          gapCount: count(learningPlanGaps.id),
          createdAt: learningPlans.createdAt,
        })
        .from(learningPlans)
        .leftJoin(learningPlanGaps, eq(learningPlanGaps.learningPlanId, learningPlans.id))
        .where(eq(learningPlans.userId, userId))
        .groupBy(learningPlans.id)
        .orderBy(desc(learningPlans.createdAt), desc(learningPlans.id));
    },

    async markLearningPlanReviewed(userId, planId, notes) {
      const [updated] = await db
        .update(learningPlans)
        .set({ reviewStatus: 'reviewed', notes })
        .where(
          and(
            eq(learningPlans.userId, userId),
            eq(learningPlans.id, planId),
            eq(learningPlans.reviewStatus, 'draft'),
          ),
        )
        .returning();
      if (updated) return { kind: 'reviewed', plan: updated };

      const [existing] = await db
        .select({ id: learningPlans.id })
        .from(learningPlans)
        .where(and(eq(learningPlans.userId, userId), eq(learningPlans.id, planId)))
        .limit(1);
      return existing ? { kind: 'already_reviewed' } : { kind: 'not_found' };
    },
  };
}
