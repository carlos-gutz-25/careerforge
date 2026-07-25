import {
  type InterviewPrep,
  type InterviewPrepPoint,
  type InterviewPrepQuestion,
  type InterviewPrepResponse,
  type InterviewPrepReviewResponse,
  type InterviewPrepRun,
} from '@careerforge/core';
import {
  type InterviewPrepRunInsert,
  type InterviewPrepRunRow,
  type InterviewPrepsRepository,
  type InterviewQuestionInsert,
  type LearningPlanPointerRead,
  type PrepWithQuestions,
  type ProfileRepository,
} from '@careerforge/db';
import {
  buildInterviewPayload,
  interviewPrepV1,
  runPrompt,
  type InterviewPayload,
  type InterviewPrepOutput,
  type LlmCallRecord,
  type LlmProvider,
} from '@careerforge/llm';

import { stripNulChars, toPlainJson } from '../extraction/extraction.service.ts';

// M3-04: interview-prep drafting service — the fourth drafting ingress under
// ADR-0013's shared safety template, pin-to-report (M1-12 pattern) reached
// through the POSTING (resolve latest report, require reviewed). Error
// classes live with their owning service (the A1 precedent).

export class PostingNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Id-free: posting ids are caller-supplied path input.
    super('job posting not found');
  }
}

export class NoFitReportError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_FIT_REPORT';
  constructor() {
    super('the posting has no fit report — score it before drafting interview prep');
  }
}

export class ReportNotReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'REPORT_NOT_REVIEWED';
  constructor() {
    // Gate decision (a): the prep reflects CURRENT scoring state — the
    // latest report must itself be reviewed; an older reviewed report is
    // never silently substituted.
    super('the latest fit report is still a draft — review it before drafting interview prep');
  }
}

export class NoVerifiedRequirementsError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_VERIFIED_REQUIREMENTS';
  constructor() {
    // Strict === true filter (gate condition 1): failed-verification AND
    // never-verified requirements are both excluded; none left = nothing a
    // prep may be grounded in, refused BEFORE any paid call.
    super('the report has no quote-verified requirements — nothing to draft from');
  }
}

export class PrepNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('interview prep not found');
  }
}

export class PrepAlreadyReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'PREP_ALREADY_REVIEWED';
  constructor() {
    super('interview prep is already reviewed');
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

/** Value-free tripwire telemetry (route-log counts, never text). */
export interface TripwireCounts {
  /** Requirement or evidence refs cited that were never sent. */
  fabricatedRefCount: number;
  /** Evidence refs cited on a question of a DIFFERENT requirement. */
  crossRequirementEvidenceCount: number;
  /** Disclosure-obliged questions with zero gap disclosures (commission). */
  missingDisclosureCount: number;
  /** Disclosures on requirements with NO obligation — a spurious disclosure
   *  would stamp an incoherent badge (or crash the two-target CHECK), so it
   *  flags like a fabrication (the review seat's bidirectional condition). */
  spuriousDisclosureCount: number;
}

export interface TripwireVerdict extends TripwireCounts {
  failed: boolean;
  /** Server-resolved question tree — defined ONLY when every tripwire
   *  passed; one failure poisons the whole output (no partial writes). */
  questions: InterviewQuestionInsert[] | undefined;
}

/**
 * The M3-04 tripwires (ADR-0006 layer-4 analogs), all deterministic and
 * server-side, evaluated BEFORE any insert:
 * 1. CITATION — every requirementRef and evidenceRef must be in the sent
 *    set, and every evidenceRef must belong to ITS question's requirement
 *    (no cross-requirement bleed).
 * 2. DISCLOSURE, BIDIRECTIONAL — a question on a disclosure-obliged
 *    requirement must carry >=1 gap disclosure (a silent gap = a fabricated
 *    citation), and a disclosure on an UNOBLIGED requirement (no gap row,
 *    or classification 'have') is equally flagged.
 * Any failure ⇒ the run lands 'flagged' via the repository policy site and
 * NOTHING is written. Points map disclosures-first, then evidence (the
 * two-array prompt output → typed rows; positions from array order).
 */
export function validateInterviewOutput(
  output: InterviewPrepOutput,
  payload: InterviewPayload,
): TripwireVerdict {
  let fabricatedRefCount = 0;
  let crossRequirementEvidenceCount = 0;
  let missingDisclosureCount = 0;
  let spuriousDisclosureCount = 0;
  const questions: InterviewQuestionInsert[] = [];

  for (const question of output.questions) {
    const requirementId = payload.requirementIdByRef.get(question.requirementRef);
    if (requirementId === undefined) {
      fabricatedRefCount += 1;
      continue;
    }
    const obliged = payload.disclosureRequiredRefs.has(question.requirementRef);
    if (obliged && question.gapDisclosures.length === 0) missingDisclosureCount += 1;
    if (!obliged && question.gapDisclosures.length > 0) {
      spuriousDisclosureCount += question.gapDisclosures.length;
    }

    const gap = payload.gapByRequirementRef.get(question.requirementRef);
    const points: InterviewQuestionInsert['points'] = [];
    if (obliged && gap) {
      for (const text of question.gapDisclosures) {
        points.push({ type: 'gap_disclosure', gapId: gap.gapId, text });
      }
    }
    for (const point of question.evidencePoints) {
      const resolved = payload.evidenceByRef.get(point.evidenceRef);
      if (resolved === undefined) {
        fabricatedRefCount += 1;
        continue;
      }
      if (resolved.requirementRef !== question.requirementRef) {
        crossRequirementEvidenceCount += 1;
        continue;
      }
      points.push({ type: 'evidence', evidenceLinkId: resolved.evidenceLinkId, text: point.text });
    }
    questions.push({ requirementId, kind: question.kind, question: question.question, points });
  }

  const failed =
    fabricatedRefCount +
      crossRequirementEvidenceCount +
      missingDisclosureCount +
      spuriousDisclosureCount >
    0;
  return {
    fabricatedRefCount,
    crossRequirementEvidenceCount,
    missingDisclosureCount,
    spuriousDisclosureCount,
    failed,
    questions: failed ? undefined : questions,
  };
}

export interface InterviewDraftResult {
  response: InterviewPrepResponse;
  /** false = existing prep served, no LLM call (HTTP 200); true = fresh wire
   *  call(s) persisted (HTTP 201 — including non-ok/flagged terminal
   *  outcomes, which are results, not transport errors). */
  created: boolean;
  /** Route-log telemetry (value-free): the tripwire counts plus how many
   *  requirements the strict verified filter excluded. */
  telemetry: TripwireCounts & { excludedRequirementCount: number };
}

export interface InterviewPrepService {
  /** POST /postings/:id/interview-prep — resolve the posting's LATEST report
   *  (404 posting / 409 NO_FIT_REPORT / 409 REPORT_NOT_REVIEWED), then draft
   *  from verified structured data only; one prep per report (UNIQUE as
   *  cache — 200-existing, no force lever; regeneration = re-score). */
  draft(userId: string, postingId: string): Promise<InterviewDraftResult>;
  /** GET /postings/:id/interview-prep — the latest report's prep-or-null
   *  (posting must exist; NO report at all = the empty collection, not an
   *  error — GETs stay side-effect-free and precondition-free). R2 run
   *  selection: the prep's own drafting run; latest-by-time only when null. */
  getPrep(userId: string, postingId: string): Promise<InterviewPrepResponse>;
  /** POST /interview-preps/:id/review — one-shot draft→reviewed (CAS). */
  review(
    userId: string,
    prepId: string,
    notes: string | null | undefined,
  ): Promise<InterviewPrepReviewResponse>;
}

/** Values that trim to empty land as NULL (the postings metadata precedent). */
function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** LlmCallRecord → repository insert (the extraction service mapping:
 *  flattened usage, timestamp → createdAt, NUL-stripped rawResponse). */
function toInsert(record: LlmCallRecord): InterviewPrepRunInsert {
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
function toWireRun(row: InterviewPrepRunRow): InterviewPrepRun {
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

export function createInterviewPrepService(deps: {
  interviews: InterviewPrepsRepository;
  /** NARROW read-only pointer view (M3-03 pattern) — the interview module
   *  cannot reach any other learning-plan surface. */
  learningPlanPointers: LearningPlanPointerRead;
  profile: ProfileRepository;
  /** undefined = no key in env; drafting is 503 until one is configured. */
  provider: LlmProvider | undefined;
  now?: () => number;
}): InterviewPrepService {
  const { interviews, learningPlanPointers, profile, provider } = deps;
  const prompt = interviewPrepV1;

  /** Stored tree → the wire prep. The learning-plan pointer is computed HERE
   *  on every read (one batched query over the disclosed gap ids) — never
   *  stored, so a plan created after drafting appears on the next GET, and
   *  the LLM never sees or emits plan ids (M3-04 §4). gapClassification is
   *  the LIVE server truth the UI badges from (gate condition 3). */
  async function toWirePrep(userId: string, stored: PrepWithQuestions): Promise<InterviewPrep> {
    const disclosedGapIds = [
      ...new Set(
        stored.questions
          .flatMap((question) => question.points)
          .map((row) => row.point.gapId)
          .filter((gapId): gapId is string => gapId !== null),
      ),
    ];
    const pointers = await learningPlanPointers.listPlanPointersByGapIds(userId, disclosedGapIds);

    const questions: InterviewPrepQuestion[] = stored.questions.map((row) => ({
      id: row.question.id,
      kind: row.question.kind,
      question: row.question.question,
      position: row.question.position,
      requirementId: row.question.requirementId,
      requirementText: row.requirementText,
      requirementKind: row.requirementKind,
      requirementCategory: row.requirementCategory,
      points: row.points.map((pointRow): InterviewPrepPoint => {
        const { point } = pointRow;
        if (point.type === 'evidence') {
          if (
            point.evidenceLinkId === null ||
            pointRow.evidenceStrength === null ||
            pointRow.evidencePostingQuote === null ||
            pointRow.evidenceProfileQuote === null
          ) {
            // Structurally impossible at rest (two-target CHECK + CASCADE FK).
            throw new Error('evidence point missing its evidence link');
          }
          return {
            id: point.id,
            type: 'evidence',
            text: point.text,
            position: point.position,
            evidenceLinkId: point.evidenceLinkId,
            evidenceStrength: pointRow.evidenceStrength,
            evidencePostingQuote: pointRow.evidencePostingQuote,
            evidenceProfileQuote: pointRow.evidenceProfileQuote,
          };
        }
        if (point.gapId === null || pointRow.gapClassification === null) {
          throw new Error('gap disclosure point missing its gap');
        }
        return {
          id: point.id,
          type: 'gap_disclosure',
          text: point.text,
          position: point.position,
          gapId: point.gapId,
          gapClassification: pointRow.gapClassification,
          learningPlans: pointers.get(point.gapId) ?? [],
        };
      }),
    }));

    return {
      id: stored.prep.id,
      fitReportId: stored.prep.fitReportId,
      reviewStatus: stored.prep.reviewStatus,
      notes: stored.prep.notes,
      createdAt: stored.prep.createdAt.toISOString(),
      questions,
    };
  }

  return {
    async draft(userId, postingId) {
      const posting = await interviews.findPostingId(userId, postingId);
      // Missing and foreign-owned are the same 404 (user-scoped read).
      if (!posting) throw new PostingNotFoundError();
      const report = await interviews.findLatestReportForPosting(userId, postingId);
      if (!report) throw new NoFitReportError();
      if (report.reviewStatus !== 'reviewed') throw new ReportNotReviewedError();

      const zeroCounts: TripwireCounts = {
        fabricatedRefCount: 0,
        crossRequirementEvidenceCount: 0,
        missingDisclosureCount: 0,
        spuriousDisclosureCount: 0,
      };

      // UNIQUE-as-cache (ADR-0005 §4 analog): an existing prep is served
      // with no LLM call; regeneration = re-score (a new report).
      const existing = await interviews.findPrepForReport(userId, report.id);
      if (existing) {
        return {
          response: {
            run: toWireRun(existing.run),
            prep: await toWirePrep(userId, existing),
            cached: true,
          },
          created: false,
          telemetry: { ...zeroCounts, excludedRequirementCount: 0 },
        };
      }

      // Drafting inputs: the report's requirements (tri-state, with each
      // requirement's gap row on THIS report), its evidence links, and the
      // profile skill summary. All verified structured data (ADR-0005 §3);
      // the posting-derived strings inside travel ONLY as delimited
      // untrusted data (ADR-0006 layers 2/5) — raw posting text never
      // re-enters an LLM call.
      const requirementRows = await interviews.findRequirementsForReport(userId, report.id);
      const evidenceRows = await interviews.findEvidenceForReport(userId, report.id);
      const profileData = await profile.getProfile(userId);
      const built = buildInterviewPayload(
        profileData.skills.map((skill) => ({ name: skill.name, level: skill.level })),
        requirementRows.map((row) => ({
          requirementId: row.requirementId,
          quoteVerified: row.quoteVerified,
          text: row.text,
          kind: row.kind,
          category: row.category,
          gap:
            row.gapId !== null && row.gapClassification !== null
              ? { gapId: row.gapId, classification: row.gapClassification }
              : null,
        })),
        evidenceRows,
      );
      // Nothing verified to draft from → 409 BEFORE any paid call (gate
      // decision (e) + condition 1: only === true counts).
      if (built.verifiedRequirementCount === 0) throw new NoVerifiedRequirementsError();

      if (!provider) throw new LlmNotConfiguredError();

      // The collecting sink (F4): an array push cannot throw, so the
      // must-not-throw contract holds structurally; every collected record
      // reaches interview_prep_runs in ONE transaction below.
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
          await interviews.persistDraftingOutcome(
            userId,
            report.id,
            records.map(toInsert),
            false,
            undefined,
          );
        } catch {
          auditNote = ` (audit record persistence also failed; ${String(records.length)} record(s) lost)`;
        }
        throw new LlmUpstreamError(errorName, auditNote);
      }

      // Tripwires (citation + bidirectional disclosure): one failure poisons
      // the output — the run lands 'flagged' via the repository's single
      // policy site and NOTHING is written. No auto-retry; re-POST is the
      // manual retry.
      let verdict: TripwireVerdict | undefined;
      if (result.status === 'ok') {
        verdict = validateInterviewOutput(result.output, built);
      }
      // Counts ONLY — never the verdict object itself: it carries the drafted
      // question tree, and telemetry feeds the route log (value-free law;
      // the log-capture test caught exactly this spread once).
      const counts: TripwireCounts = verdict
        ? {
            fabricatedRefCount: verdict.fabricatedRefCount,
            crossRequirementEvidenceCount: verdict.crossRequirementEvidenceCount,
            missingDisclosureCount: verdict.missingDisclosureCount,
            spuriousDisclosureCount: verdict.spuriousDisclosureCount,
          }
        : zeroCounts;

      const outcome = await interviews.persistDraftingOutcome(
        userId,
        report.id,
        records.map(toInsert),
        verdict?.failed ?? false,
        verdict?.questions,
      );
      const telemetry = {
        ...counts,
        excludedRequirementCount: built.excludedRequirementCount,
      };

      if (outcome.conflicted) {
        // The lost double-POST race: a concurrent draft won; serve ITS prep
        // (both wire calls stay recorded — honest telemetry).
        const winner = await interviews.findPrepForReport(userId, report.id);
        if (!winner) throw new Error('conflicted persist but no prep found');
        return {
          response: {
            run: toWireRun(winner.run),
            prep: await toWirePrep(userId, winner),
            cached: true,
          },
          created: false,
          telemetry,
        };
      }

      if (outcome.prepCreated) {
        const stored = await interviews.findPrepForReport(userId, report.id);
        if (!stored) throw new Error('prep persisted but not readable');
        return {
          response: {
            run: toWireRun(stored.run),
            prep: await toWirePrep(userId, stored),
            cached: false,
          },
          created: true,
          telemetry,
        };
      }

      // Non-ok terminal or flagged: a result, not a transport error — the
      // append-only run ledger gained row(s); run.status is the discriminant.
      const finalRun = outcome.runs[outcome.runs.length - 1];
      if (!finalRun) throw new Error('drafting persisted no runs');
      return {
        response: { run: toWireRun(finalRun), prep: null, cached: false },
        created: true,
        telemetry,
      };
    },

    async getPrep(userId, postingId) {
      const posting = await interviews.findPostingId(userId, postingId);
      if (!posting) throw new PostingNotFoundError();
      const report = await interviews.findLatestReportForPosting(userId, postingId);
      // No report at all: the empty collection (nothing could have been
      // drafted; a GET carries no preconditions). A re-score also lands
      // here for the NEW report until a fresh prep is drafted — the
      // posting-scoped view always reflects CURRENT scoring state.
      if (!report) return { run: null, prep: null, cached: false };
      const stored = await interviews.findPrepForReport(userId, report.id);
      if (stored) {
        // R2: the run under a prep is the prep's OWN drafting run.
        return {
          run: toWireRun(stored.run),
          prep: await toWirePrep(userId, stored),
          cached: false,
        };
      }
      // Prep-null: latest-by-time run for failure display, or nothing yet.
      const latest = await interviews.findLatestRunForReport(userId, report.id);
      return { run: latest ? toWireRun(latest) : null, prep: null, cached: false };
    },

    async review(userId, prepId, notes) {
      const outcome = await interviews.markPrepReviewed(userId, prepId, trimmedOrNull(notes));
      if (outcome.kind === 'not_found') throw new PrepNotFoundError();
      if (outcome.kind === 'already_reviewed') throw new PrepAlreadyReviewedError();
      return {
        id: outcome.prep.id,
        reviewStatus: outcome.prep.reviewStatus,
        notes: outcome.prep.notes,
      };
    },
  };
}
