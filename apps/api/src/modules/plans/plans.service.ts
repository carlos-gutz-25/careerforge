import {
  containsExternalPointer,
  type FitReportPlanResponse,
  type ImprovementPlanResponse,
  type PlanDraftingRun,
  type PlanItemPatchBody,
  type PlanItemRecommendationResponse,
  type PlanItemRecommendationStatus,
  type PlanItemResponse,
  type PlanReviewResponse,
} from '@careerforge/core';
import {
  type GapsRepository,
  type ImprovementPlanRunRow,
  type ImprovementPlansRepository,
  type PlanDraftingRunInsert,
  type PlanItemInsert,
  type PlanItemRecommendationRow,
  type PlanItemWithGap,
  type PlanWithItems,
  type ProfileRepository,
} from '@careerforge/db';
import {
  buildDraftingPayload,
  improvementPlanV2,
  mapCitedRefs,
  runPrompt,
  type DraftingEvidenceInput,
  type DraftingGapInput,
  type LlmCallRecord,
  type LlmProvider,
} from '@careerforge/llm';

import { stripNulChars, toPlainJson } from '../extraction/extraction.service.ts';

// Error classes live with their owning service (the A1 precedent); same
// codes as sibling modules where semantics match, plan-specific messages.

export class ReportNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Id-free: report ids are caller-supplied path input.
    super('fit report not found');
  }
}

export class ReportNotReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'REPORT_NOT_REVIEWED';
  constructor() {
    // The pipeline diagram places drafting after "Carlos reviews (always)"
    // (ARCHITECTURE section 4): the paid call consumes post-review effective
    // classifications, never pre-review noise.
    super('fit report is still a draft — review it before drafting a plan');
  }
}

export class NoActionableGapsError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_ACTIONABLE_GAPS';
  constructor() {
    super('the report has no actionable gaps — nothing to draft');
  }
}

export class PlanNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('improvement plan not found');
  }
}

export class PlanAlreadyReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'PLAN_ALREADY_REVIEWED';
  constructor() {
    super('improvement plan is already reviewed');
  }
}

export class PlanItemNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('plan item not found');
  }
}

export class PlanItemRecommendationNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Id-free: recommendation ids are caller-supplied path input.
    super('plan item recommendation not found');
  }
}

export class LlmNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'LLM_NOT_CONFIGURED';
  constructor() {
    super('no LLM provider configured — set ANTHROPIC_API_KEY');
  }
}

export class LlmUpstreamError extends Error {
  readonly statusCode = 502;
  readonly code = 'LLM_UPSTREAM_ERROR';
  // Value-free by construction (the extraction module's law): the upstream
  // error's NAME only, plus audit-outcome metadata.
  constructor(errorName: string, auditNote: string) {
    super(`LLM provider call failed: ${errorName}${auditNote}`);
  }
}

export interface PlanDraftResult {
  response: FitReportPlanResponse;
  /** false = existing plan served, no LLM call (HTTP 200); true = fresh wire
   *  call(s) persisted (HTTP 201 — including non-ok/flagged terminal
   *  outcomes, which are results, not transport errors). */
  created: boolean;
  /** Route-log telemetry (value-free count): refs the model cited that were
   *  never sent - contributes to 'flagged' (citation tripwire). */
  fabricatedRefCount: number;
  /** Route-log telemetry (value-free count): external-pointer hits across all
   *  drafted recommendation fields (ADR-0017) - contributes to 'flagged'
   *  independently of the citation count, so a flagged run's CAUSE is
   *  attributable. */
  pointerHitCount: number;
}

export interface PlansService {
  /** POST /fit-reports/:id/improvement-plan — drafts from verified
   *  structured data only (ADR-0005 §3); requires a REVIEWED report; one
   *  plan per report (UNIQUE as cache — 200-existing, no force lever). */
  draft(userId: string, reportId: string): Promise<PlanDraftResult>;
  /** GET /fit-reports/:id/improvement-plan — plan-or-null (empty collection,
   *  not a 404; the report must exist). R2 run selection: the plan's own
   *  drafting run when a plan exists; latest-by-time only when null. */
  getPlan(userId: string, reportId: string): Promise<FitReportPlanResponse>;
  /** POST /improvement-plans/:id/review — one-shot draft→reviewed (CAS). */
  review(
    userId: string,
    planId: string,
    notes: string | null | undefined,
  ): Promise<PlanReviewResponse>;
  /** PATCH /plan-items/:id — full replacement of status + priority (A2);
   *  action/gap/position immutable. */
  updateItem(userId: string, itemId: string, body: PlanItemPatchBody): Promise<PlanItemResponse>;
  /** PATCH /plan-item-recommendations/:id - a plain status setter to any of
   *  the three lifecycle values (ADR-0017; status is the only mutable field).
   *  User-scoped; 404 on missing/foreign. */
  updateRecommendation(
    userId: string,
    recommendationId: string,
    status: PlanItemRecommendationStatus,
  ): Promise<PlanItemRecommendationResponse>;
}

/** Values that trim to empty land as NULL (the postings metadata precedent). */
function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** LlmCallRecord → repository insert (the extraction service mapping:
 *  flattened usage, timestamp → createdAt, NUL-stripped rawResponse). */
function toInsert(record: LlmCallRecord): PlanDraftingRunInsert {
  return {
    promptId: record.promptId,
    provider: record.provider,
    model: record.model,
    rawResponse: stripNulChars(toPlainJson(record.rawResponse)),
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheReadInputTokens: record.usage.cacheReadInputTokens,
    cacheCreationInputTokens: record.usage.cacheCreationInputTokens,
    latencyMs: record.latencyMs,
    attempt: record.attempt,
    status: record.status,
    createdAt: new Date(record.timestamp),
  };
}

/** Row → the wire run (usage on the wire per RISKS T-03; rawResponse and
 *  userId never leave the row — the toWireRun precedent). */
function toWireRun(row: ImprovementPlanRunRow): PlanDraftingRun {
  return {
    id: row.id,
    promptId: row.promptId,
    provider: row.provider,
    model: row.model,
    status: row.status,
    attempt: row.attempt,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Row -> the ONE recommendation wire contract (GET and PATCH share it).
 *  user_id and the timestamps never leave the row (the toWireRun omission);
 *  title/rationale/expectedBenefit are model-drafted - UNTRUSTED on display. */
function toWireRecommendation(row: PlanItemRecommendationRow): PlanItemRecommendationResponse {
  return {
    id: row.id,
    planItemId: row.planItemId,
    kind: row.kind,
    status: row.status,
    title: row.title,
    rationale: row.rationale,
    expectedBenefit: row.expectedBenefit,
    position: row.position,
  };
}

/** Group findRecommendationsForPlan's rows (already ordered item-position,
 *  rec-position, id) onto their plan_item_id - the GET projection (D6). Push
 *  preserves the repository's canonical order. */
function groupRecommendations(
  rows: PlanItemRecommendationRow[],
): Map<string, PlanItemRecommendationResponse[]> {
  const byItem = new Map<string, PlanItemRecommendationResponse[]>();
  for (const row of rows) {
    const wire = toWireRecommendation(row);
    const list = byItem.get(wire.planItemId);
    if (list) list.push(wire);
    else byItem.set(wire.planItemId, [wire]);
  }
  return byItem;
}

/** Join row → the ONE item wire contract (GET and PATCH share it). The gap
 *  display fields are posting-derived: UNTRUSTED on display. Recommendations
 *  are grouped in by the caller (empty when the item has none). */
function toWireItem(
  row: PlanItemWithGap,
  recommendations: PlanItemRecommendationResponse[] = [],
): PlanItemResponse {
  return {
    id: row.item.id,
    gapId: row.item.gapId,
    action: row.item.action,
    priority: row.item.priority,
    status: row.item.status,
    position: row.item.position,
    gapClassification: row.gapClassification,
    gapRequirementId: row.gapRequirementId,
    requirementText: row.requirementText,
    requirementKind: row.requirementKind,
    requirementCategory: row.requirementCategory,
    recommendations,
  };
}

function toWirePlan(
  stored: PlanWithItems,
  recsByItem: Map<string, PlanItemRecommendationResponse[]>,
): ImprovementPlanResponse {
  return {
    id: stored.plan.id,
    fitReportId: stored.plan.fitReportId,
    reviewStatus: stored.plan.reviewStatus,
    notes: stored.plan.notes,
    createdAt: stored.plan.createdAt.toISOString(),
    items: stored.items.map((row) => toWireItem(row, recsByItem.get(row.item.id) ?? [])),
  };
}

export function createPlansService(deps: {
  plans: ImprovementPlansRepository;
  gaps: GapsRepository;
  profile: ProfileRepository;
  /** undefined = no key in env; drafting is 503 until one is configured. */
  provider: LlmProvider | undefined;
  now?: () => number;
}): PlansService {
  const { plans, gaps, profile, provider } = deps;
  // M7-03: the selector flip that turns improvement-plan@v2 ON in production
  // (the M7-02 "born registered + pinned but uncalled" completion). v2 uses
  // the SAME structured drafting payload as v1 (buildDraftingPayload
  // unchanged, the M7-02 D4 pin); its one additive output field is each
  // item's `recommendations`, persisted and pointer-scanned below.
  const prompt = improvementPlanV2;

  /** A stored plan -> its wire shape with recommendations grouped in (D6).
   *  One read of the plan's recommendations (already ordered by the
   *  repository), projected by plan_item_id. */
  async function assembleWirePlan(
    userId: string,
    stored: PlanWithItems,
  ): Promise<ImprovementPlanResponse> {
    const recommendations = await plans.findRecommendationsForPlan(userId, stored.plan.id);
    return toWirePlan(stored, groupRecommendations(recommendations));
  }

  return {
    async draft(userId, reportId) {
      const report = await plans.findReportById(userId, reportId);
      // Missing and foreign-owned are the same 404 (user-scoped read).
      if (!report) throw new ReportNotFoundError();
      if (report.reviewStatus !== 'reviewed') throw new ReportNotReviewedError();

      // UNIQUE-as-cache (ADR-0005 §4 analog): an existing plan is served
      // with no LLM call; regeneration = re-score (a new report).
      const existing = await plans.findPlanForReport(userId, reportId);
      if (existing) {
        return {
          response: {
            run: toWireRun(existing.run),
            plan: await assembleWirePlan(userId, existing),
            cached: true,
          },
          created: false,
          fabricatedRefCount: 0,
          pointerHitCount: 0,
        };
      }

      // Drafting inputs: the report's gap set (EFFECTIVE classifications —
      // drafting is review-gated, so overrides have settled), its evidence
      // links, and the profile skill summary. All verified structured data
      // (ADR-0005 §3); the posting-derived strings inside travel ONLY as
      // delimited untrusted data (ADR-0006 layers 2/5).
      const gapSet = await gaps.findGapsForReport(userId, reportId);
      if (!gapSet) throw new ReportNotFoundError();
      const gapInputs: DraftingGapInput[] = gapSet.rows.map((row) => ({
        gapId: row.gap.id,
        classification: row.gap.classification,
        requirementId: row.gap.requirementId,
        requirementText: row.requirementText,
        requirementKind: row.requirementKind,
        requirementCategory: row.requirementCategory,
        rationale: row.gap.rationale,
      }));
      const evidenceInputs: DraftingEvidenceInput[] = await plans.findEvidenceForReport(
        userId,
        reportId,
      );
      const profileData = await profile.getProfile(userId);
      const built = buildDraftingPayload(
        profileData.skills.map((skill) => ({ name: skill.name, level: skill.level })),
        gapInputs,
        evidenceInputs,
      );
      // Nothing to draft → 409 BEFORE any paid call (M1-12 §3).
      if (built.eligibleGapCount === 0) throw new NoActionableGapsError();

      if (!provider) throw new LlmNotConfiguredError();

      // The collecting sink (F4): an array push cannot throw, so the
      // must-not-throw contract holds structurally; every collected record
      // reaches improvement_plan_runs in ONE transaction below.
      const records: LlmCallRecord[] = [];
      let result;
      try {
        result = await runPrompt(
          prompt,
          { untrustedData: built.payload },
          {
            provider,
            recordCall: (record) => {
              records.push(record);
            },
            ...(deps.now ? { now: deps.now } : {}),
          },
        );
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'unknown';
        // Recording is law on the error path too (the extraction pattern):
        // persist the value-free error record(s), then surface the 502.
        let auditNote = '';
        try {
          await plans.persistDraftingOutcome(
            userId,
            reportId,
            records.map(toInsert),
            false,
            undefined,
          );
        } catch {
          auditNote = ` (audit record persistence also failed; ${String(records.length)} record(s) lost)`;
        }
        throw new LlmUpstreamError(errorName, auditNote);
      }

      // Two independent server tripwires gate an ok run, both folded into the
      // ONE 'flagged' status via the repository's single policy site; either
      // hit writes NOTHING (flag-the-run-write-nothing; no auto-retry, re-POST
      // is the manual retry):
      //   (1) Citation validation (the layer-4 analog, M1-12 sec 3): every
      //       cited ref must be in the sent set - one fabricated ref poisons it.
      //   (2) External-pointer (ADR-0017, M7-03): a URL/email/domain in ANY
      //       drafted recommendation field is an unverifiable citation - one
      //       pointer poisons it. The `action` field is v1's and NOT the
      //       tripwire's surface (ADR-0017 is recommendation-scoped); the scan
      //       covers title/rationale/expectedBenefit of every recommendation.
      let items: PlanItemInsert[] | undefined;
      let citationFailed = false;
      let pointerFailed = false;
      let fabricatedRefCount = 0;
      let pointerHitCount = 0;
      if (result.status === 'ok') {
        const mapping = mapCitedRefs(
          result.output.items.map((item) => item.gapRef),
          built.gapIdByRef,
        );
        fabricatedRefCount = mapping.fabricatedRefCount;
        if (mapping.gapIds === undefined) {
          citationFailed = true;
        } else {
          const gapIds = mapping.gapIds;
          for (const item of result.output.items) {
            for (const rec of item.recommendations) {
              if (containsExternalPointer(rec.title)) pointerHitCount += 1;
              if (containsExternalPointer(rec.rationale)) pointerHitCount += 1;
              if (containsExternalPointer(rec.expectedBenefit)) pointerHitCount += 1;
            }
          }
          pointerFailed = pointerHitCount > 0;
          if (!pointerFailed) {
            items = result.output.items.map((item, index) => ({
              // mapCitedRefs preserves item order, so index alignment holds.
              gapId: gapIds[index] as string,
              action: item.action,
              priority: item.priority,
              recommendations: item.recommendations.map((rec) => ({
                kind: rec.kind,
                title: rec.title,
                rationale: rec.rationale,
                expectedBenefit: rec.expectedBenefit,
              })),
            }));
          }
        }
      }

      const outcome = await plans.persistDraftingOutcome(
        userId,
        reportId,
        records.map(toInsert),
        citationFailed || pointerFailed,
        items,
      );

      if (outcome.conflicted) {
        // The lost double-POST race: a concurrent draft won; serve ITS plan
        // (both wire calls stay recorded — honest telemetry).
        const winner = await plans.findPlanForReport(userId, reportId);
        if (!winner) throw new Error('conflicted persist but no plan found');
        return {
          response: {
            run: toWireRun(winner.run),
            plan: await assembleWirePlan(userId, winner),
            cached: true,
          },
          created: false,
          fabricatedRefCount,
          pointerHitCount,
        };
      }

      if (outcome.planCreated) {
        const stored = await plans.findPlanForReport(userId, reportId);
        if (!stored) throw new Error('plan persisted but not readable');
        return {
          response: {
            run: toWireRun(stored.run),
            plan: await assembleWirePlan(userId, stored),
            cached: false,
          },
          created: true,
          fabricatedRefCount,
          pointerHitCount,
        };
      }

      // Non-ok terminal or flagged: a result, not a transport error — the
      // append-only run ledger gained row(s); run.status is the discriminant.
      const finalRun = outcome.runs[outcome.runs.length - 1];
      if (!finalRun) throw new Error('drafting persisted no runs');
      return {
        response: { run: toWireRun(finalRun), plan: null, cached: false },
        created: true,
        fabricatedRefCount,
        pointerHitCount,
      };
    },

    async getPlan(userId, reportId) {
      const report = await plans.findReportById(userId, reportId);
      if (!report) throw new ReportNotFoundError();
      const stored = await plans.findPlanForReport(userId, reportId);
      if (stored) {
        // R2: the run under a plan is the plan's OWN drafting run.
        return {
          run: toWireRun(stored.run),
          plan: await assembleWirePlan(userId, stored),
          cached: false,
        };
      }
      // Plan-null: latest-by-time run for failure display, or nothing yet.
      const latest = await plans.findLatestRunForReport(userId, reportId);
      return { run: latest ? toWireRun(latest) : null, plan: null, cached: false };
    },

    async review(userId, planId, notes) {
      const outcome = await plans.markPlanReviewed(userId, planId, trimmedOrNull(notes));
      if (outcome.kind === 'not_found') throw new PlanNotFoundError();
      if (outcome.kind === 'already_reviewed') throw new PlanAlreadyReviewedError();
      return {
        id: outcome.plan.id,
        reviewStatus: outcome.plan.reviewStatus,
        notes: outcome.plan.notes,
      };
    },

    async updateItem(userId, itemId, body) {
      const updated = await plans.updatePlanItem(userId, itemId, body.status, body.priority);
      if (!updated) throw new PlanItemNotFoundError();
      // The item wire contract carries its recommendations (D6); the PATCH
      // touches only status/priority, but the returned row stays truthful -
      // group this item's own recommendations from the plan's ordered set.
      const recommendations = await plans.findRecommendationsForPlan(
        userId,
        updated.item.improvementPlanId,
      );
      return toWireItem(updated, groupRecommendations(recommendations).get(updated.item.id) ?? []);
    },

    async updateRecommendation(userId, recommendationId, status) {
      const updated = await plans.updatePlanItemRecommendationStatus(
        userId,
        recommendationId,
        status,
      );
      if (!updated) throw new PlanItemRecommendationNotFoundError();
      return toWireRecommendation(updated);
    },
  };
}
