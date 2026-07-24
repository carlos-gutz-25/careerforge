import {
  type CreateLearningPlanBody,
  type LearningPlan,
  type LearningPlanGap,
  type LearningPlanListResponse,
  type LearningPlanResponse,
  type LearningPlanReviewResponse,
  type LearningPlanRun,
  type LearningPlanSummary,
} from '@careerforge/core';
import {
  type GapsRepository,
  type LearningPlanGapInsert,
  type LearningPlanGapWithGap,
  type LearningPlanRunInsert,
  type LearningPlanRunRow,
  type LearningPlanSummaryRow,
  type LearningPlansRepository,
  type LearningPlanWithGaps,
  type ProfileRepository,
} from '@careerforge/db';
import {
  buildLearningPayload,
  learningPlanV1,
  mapCitedRefs,
  runPrompt,
  type LearningEvidenceInput,
  type LearningGapInput,
  type LlmCallRecord,
  type LlmProvider,
} from '@careerforge/llm';

import { stripNulChars, toPlainJson } from '../extraction/extraction.service.ts';

// M3-01: learning-plan drafting from a gap set selected ACROSS postings. The
// M1-12 plans service is the template; the deltas (ADR-0013): FREE-CREATE (no
// cache/pin), a reviewed-gate that spans EVERY selected gap's source report,
// and the recurrence ranking done deterministically in the payload builder.

export class GapsNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Id-free: gap ids are caller-supplied body input. Any unknown/foreign id
    // in the selection is one 404 outcome (the user-scoped read law).
    super('one or more selected gaps were not found');
  }
}

export class ReportsNotReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'REPORTS_NOT_REVIEWED';
  constructor() {
    // Drafting consumes post-review effective classifications (ADR-0005 §3):
    // EVERY selected gap's source report must be reviewed first.
    super('every selected gap must come from a reviewed fit report');
  }
}

export class NoActionableGapsError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_ACTIONABLE_GAPS';
  constructor() {
    super('the selection has no actionable gaps — nothing to draft');
  }
}

export class LearningPlanNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('learning plan not found');
  }
}

export class LearningPlanAlreadyReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'PLAN_ALREADY_REVIEWED';
  constructor() {
    super('learning plan is already reviewed');
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

export interface LearningDraftResult {
  response: LearningPlanResponse;
  /** true = fresh wire call(s) persisted (HTTP 201 — including non-ok/flagged
   *  terminal outcomes, which are results, not transport errors). Free-create
   *  never serves a cached 200. */
  created: boolean;
  /** Route-log telemetry (value-free count): refs the model cited that were
   *  never sent — > 0 iff the run landed 'flagged'. */
  fabricatedRefCount: number;
}

export interface LearningService {
  /** POST /learning-plans — drafts from a gap set (across postings) of REVIEWED
   *  reports; verified structured data only (ADR-0005 §3); free-create. */
  draft(userId: string, body: CreateLearningPlanBody): Promise<LearningDraftResult>;
  /** GET /learning-plans/:id — the plan with its cited gaps, or 404. */
  getPlan(userId: string, planId: string): Promise<LearningPlanResponse>;
  /** GET /learning-plans — all of the user's plans, newest first. */
  list(userId: string): Promise<LearningPlanListResponse>;
  /** POST /learning-plans/:id/review — one-shot draft→reviewed (CAS). */
  review(
    userId: string,
    planId: string,
    notes: string | null | undefined,
  ): Promise<LearningPlanReviewResponse>;
}

/** Values that trim to empty land as NULL (the plan review precedent). */
function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** LlmCallRecord → repository insert (the plans service mapping: flattened
 *  usage, timestamp → createdAt, NUL-stripped rawResponse). */
function toInsert(record: LlmCallRecord): LearningPlanRunInsert {
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

/** Row → the wire run (usage on the wire per RISKS T-03; rawResponse and userId
 *  never leave the row). */
function toWireRun(row: LearningPlanRunRow): LearningPlanRun {
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

/** Join row → the ONE cited-gap wire contract. The focus + gap display fields
 *  are LLM/posting-derived: UNTRUSTED on display. */
function toWireGap(row: LearningPlanGapWithGap): LearningPlanGap {
  return {
    id: row.row.id,
    gapId: row.row.gapId,
    focus: row.row.focus,
    priority: row.row.priority,
    position: row.row.position,
    gapClassification: row.gapClassification,
    gapRequirementId: row.gapRequirementId,
    requirementText: row.requirementText,
    requirementKind: row.requirementKind,
    requirementCategory: row.requirementCategory,
  };
}

function toWirePlan(stored: LearningPlanWithGaps): LearningPlan {
  return {
    id: stored.plan.id,
    title: stored.plan.title,
    reviewStatus: stored.plan.reviewStatus,
    notes: stored.plan.notes,
    createdAt: stored.plan.createdAt.toISOString(),
    gaps: stored.gaps.map(toWireGap),
  };
}

function toWireSummary(row: LearningPlanSummaryRow): LearningPlanSummary {
  return {
    id: row.id,
    title: row.title,
    reviewStatus: row.reviewStatus,
    gapCount: row.gapCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createLearningService(deps: {
  learning: LearningPlansRepository;
  gaps: GapsRepository;
  profile: ProfileRepository;
  /** undefined = no key in env; drafting is 503 until one is configured. */
  provider: LlmProvider | undefined;
  now?: () => number;
}): LearningService {
  const { learning, gaps, profile, provider } = deps;
  const prompt = learningPlanV1;

  return {
    async draft(userId, body) {
      // Collapse duplicate ids: a plan cannot cite the same gap twice, and the
      // completeness check below must compare against the DISTINCT selection.
      const gapIds = [...new Set(body.gapIds)];
      const selected = await gaps.findGapsByIds(userId, gapIds);
      // Any id the caller does not own (or that does not exist) is absent →
      // one 404 outcome.
      if (selected.length !== gapIds.length) throw new GapsNotFoundError();
      // Every selected gap's source report must be reviewed (ADR-0013).
      if (selected.some((row) => row.reportReviewStatus !== 'reviewed')) {
        throw new ReportsNotReviewedError();
      }

      const gapInputs: LearningGapInput[] = selected.map((row) => ({
        gapId: row.gap.id,
        classification: row.gap.classification,
        requirementId: row.gap.requirementId,
        fitReportId: row.gap.fitReportId,
        postingId: row.postingId,
        requirementText: row.requirementText,
        requirementKind: row.requirementKind,
        requirementCategory: row.requirementCategory,
        rationale: row.gap.rationale,
      }));

      const reportIds = [...new Set(selected.map((row) => row.gap.fitReportId))];
      const evidenceRows = await learning.findEvidenceForReports(userId, reportIds);
      const evidenceInputs: LearningEvidenceInput[] = evidenceRows.map((row) => ({
        fitReportId: row.fitReportId,
        requirementId: row.requirementId,
        strength: row.strength,
        postingQuote: row.postingQuote,
        profileQuote: row.profileQuote,
      }));

      const profileData = await profile.getProfile(userId);
      const built = buildLearningPayload(
        profileData.skills.map((skill) => ({ name: skill.name, level: skill.level })),
        gapInputs,
        evidenceInputs,
      );
      // Nothing to draft → 409 BEFORE any paid call.
      if (built.eligibleGapCount === 0) throw new NoActionableGapsError();

      if (!provider) throw new LlmNotConfiguredError();

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
        // Recording is law on the error path too (the plans pattern): persist
        // the value-free error record(s), then surface the 502.
        let auditNote = '';
        try {
          await learning.persistDraftingOutcome(userId, records.map(toInsert), false, undefined);
        } catch {
          auditNote = ` (audit record persistence also failed; ${String(records.length)} record(s) lost)`;
        }
        throw new LlmUpstreamError(errorName, auditNote);
      }

      // Citation validation (the M1-12 layer-4 analog): every cited ref must be
      // in the sent set. One fabricated ref poisons the output — the run lands
      // 'flagged' via the repository's single policy site and NO plan is
      // written. No auto-retry; re-POST is the manual retry.
      let plan: { title: string; gaps: LearningPlanGapInsert[] } | undefined;
      let citationFailed = false;
      let fabricatedRefCount = 0;
      if (result.status === 'ok') {
        const mapping = mapCitedRefs(
          result.output.items.map((item) => item.gapRef),
          built.gapIdByRef,
        );
        fabricatedRefCount = mapping.fabricatedRefCount;
        if (mapping.gapIds === undefined) {
          citationFailed = true;
        } else {
          const gapIdsForItems = mapping.gapIds;
          plan = {
            title: result.output.title,
            gaps: result.output.items.map((item, index) => ({
              // mapCitedRefs preserves item order, so index alignment holds.
              gapId: gapIdsForItems[index] as string,
              focus: item.focus,
              priority: item.priority,
            })),
          };
        }
      }

      const outcome = await learning.persistDraftingOutcome(
        userId,
        records.map(toInsert),
        citationFailed,
        plan,
      );

      if (outcome.planCreated && outcome.planId !== undefined) {
        const created = await learning.findLearningPlan(userId, outcome.planId);
        if (!created) throw new Error('plan persisted but not readable');
        return {
          response: { run: toWireRun(created.run), plan: toWirePlan(created), cached: false },
          created: true,
          fabricatedRefCount,
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
      };
    },

    async getPlan(userId, planId) {
      const stored = await learning.findLearningPlan(userId, planId);
      if (!stored) throw new LearningPlanNotFoundError();
      return { run: toWireRun(stored.run), plan: toWirePlan(stored), cached: false };
    },

    async list(userId) {
      const rows = await learning.listLearningPlans(userId);
      return { plans: rows.map(toWireSummary) };
    },

    async review(userId, planId, notes) {
      const outcome = await learning.markLearningPlanReviewed(userId, planId, trimmedOrNull(notes));
      if (outcome.kind === 'not_found') throw new LearningPlanNotFoundError();
      if (outcome.kind === 'already_reviewed') throw new LearningPlanAlreadyReviewedError();
      return {
        id: outcome.plan.id,
        reviewStatus: outcome.plan.reviewStatus,
        notes: outcome.plan.notes,
      };
    },
  };
}
