import {
  type FitReportData,
  type FitReportGapsResponse,
  type FitReportResponse,
  type FitReviewResponse,
  type GapOverrideBody,
  type GapResponse,
  type PostingFitResponse,
  type ScoringRequirement,
  type SearchCriteriaData,
  type UnscoredRequirement,
} from '@careerforge/core';
import {
  type ExtractionsRepository,
  type FitReportRow,
  type FitReportsRepository,
  type FitSubScoreWithEvidence,
  type GapsRepository,
  type GapWithRequirement,
  type PostingsRepository,
  type ProfileRepository,
  type RequirementRow,
  type SearchCriteriaRepository,
} from '@careerforge/db';
import { classifyGaps, scoreFit } from '@careerforge/scoring';

import { CriteriaNotFoundError } from '../criteria/criteria.service.ts';
import { PostingNotFoundError } from '../postings/postings.service.ts';

// Error classes live with their owning service (plan amendment A1 — the
// PostingNotFoundError precedent). The extraction module has its own
// PostingArchivedError; same code, scoring-specific message.

export class PostingArchivedError extends Error {
  readonly statusCode = 409;
  readonly code = 'POSTING_ARCHIVED';
  constructor() {
    super('posting is archived — unarchive it before scoring');
  }
}

export class PostingNotExtractedError extends Error {
  readonly statusCode = 409;
  readonly code = 'POSTING_NOT_EXTRACTED';
  constructor() {
    super('posting has no extracted requirements yet — extract before scoring');
  }
}

export class ReportNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Id-free like PostingNotFoundError: report ids are caller-supplied
    // path input and 4xx messages reach the response body.
    super('fit report not found');
  }
}

export class ReportAlreadyReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'REPORT_ALREADY_REVIEWED';
  constructor() {
    super('fit report is already reviewed — re-score for a fresh draft');
  }
}

export class GapNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Id-free like the report 404: gap ids are caller-supplied path input.
    super('gap not found');
  }
}

export interface FitScoreResult {
  report: FitReportResponse;
  /** true iff this scoring flipped the posting extracted -> scored (route
   *  telemetry only — counts/booleans, the log privacy law). */
  postingFlipped: boolean;
}

export interface FitService {
  /** POST /postings/:id/fit — always scores fresh and APPENDS (M1-09 law);
   *  scoring is deterministic and LLM-free, so there is no cache and no
   *  force lever. */
  score(userId: string, postingId: string): Promise<FitScoreResult>;
  /** GET /postings/:id/fit — the LATEST report or `report: null` (an empty
   *  collection, not a 404; reads are never archived-gated, plan A4). */
  getReport(userId: string, postingId: string): Promise<PostingFitResponse>;
  /** POST /fit-reports/:id/review — one-shot draft->reviewed (D8). */
  review(
    userId: string,
    reportId: string,
    notes: string | null | undefined,
  ): Promise<FitReviewResponse>;
  /** GET /fit-reports/:id/gaps — the report's gap set, report-scoped
   *  (ARCHITECTURE §5); 404 on missing/foreign. Pre-0006 reports serve
   *  `{ gaps: [], lostOverrides: 0 }` (R3). */
  getGaps(userId: string, reportId: string): Promise<FitReportGapsResponse>;
  /** PATCH /gaps/:id — the override (A2 full replacement; null
   *  classification = D6 un-override); 404 on missing/foreign. */
  overrideGap(userId: string, gapId: string, body: GapOverrideBody): Promise<GapResponse>;
}

/** Values that trim to empty land as NULL (the postings metadata precedent). */
function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * unscoredRequirements re-derived from the SCORED run's rows (M1-09
 * disposition: deliberately not persisted — quoteVerified is immutable once
 * true/false; NULL states can still move via the backfill CLI, an accepted
 * residual with a zero, only-shrinking population). Same derivation the
 * engine applies internally, so POST-time and read-time views agree.
 */
function deriveUnscored(rows: RequirementRow[]): UnscoredRequirement[] {
  return rows
    .filter((row) => row.quoteVerified !== true)
    .map((row) => ({
      requirementId: row.id,
      reason:
        row.quoteVerified === false
          ? ('failed_verification' as const)
          : ('not_yet_verified' as const),
    }));
}

/** Rows -> the wire report. The canonical payload is REBUILT from persisted
 *  rows and re-validated by the route's response schema — DB, engine, and
 *  wire stay one contract. */
function toWireReport(
  row: FitReportRow,
  subScores: FitSubScoreWithEvidence[],
  runRequirements: RequirementRow[],
): FitReportResponse {
  const report: FitReportData = {
    verdict: row.verdict,
    exclusions: row.exclusions,
    subScores: subScores.map(({ subScore, evidence }) => ({
      dimension: subScore.dimension,
      score: subScore.score,
      rationale: subScore.rationale,
      evidence: evidence.map((link) => ({
        requirementId: link.requirementId,
        profileSkillId: link.profileSkillId,
        profileProjectId: link.profileProjectId,
        profileExperienceId: link.profileExperienceId,
        postingQuote: link.postingQuote,
        profileQuote: link.profileQuote,
        strength: link.strength,
      })),
    })),
    unscoredRequirements: deriveUnscored(runRequirements),
    forcedLowestPriority: row.forcedLowest,
    inputFlagged: row.inputFlagged,
  };
  return {
    id: row.id,
    postingId: row.postingId,
    extractionRunId: row.extractionRunId,
    reviewStatus: row.reviewStatus,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    report,
  };
}

/** Repository join row -> the ONE wire row contract (GET and PATCH share
 *  it). Requirement fields are posting-derived: UNTRUSTED on display. */
function toWireGap(row: GapWithRequirement): GapResponse {
  return {
    id: row.gap.id,
    fitReportId: row.gap.fitReportId,
    requirementId: row.gap.requirementId,
    classification: row.gap.classification,
    engineClassification: row.gap.engineClassification,
    rationale: row.gap.rationale,
    userOverridden: row.gap.userOverridden,
    overrideNote: row.gap.overrideNote,
    carriedVia: row.gap.carriedVia,
    createdAt: row.gap.createdAt.toISOString(),
    requirementText: row.requirementText,
    requirementKind: row.requirementKind,
    requirementCategory: row.requirementCategory,
  };
}

export function createFitService(deps: {
  postings: PostingsRepository;
  extractions: ExtractionsRepository;
  criteria: SearchCriteriaRepository;
  profile: ProfileRepository;
  fitReports: FitReportsRepository;
  gaps: GapsRepository;
}): FitService {
  const { postings, extractions, criteria, profile, fitReports, gaps } = deps;
  return {
    async score(userId, postingId) {
      const posting = await postings.findForUser(userId, postingId);
      // Missing and foreign-owned are the same 404 (user-scoped read).
      if (!posting) throw new PostingNotFoundError();
      if (posting.status === 'archived') throw new PostingArchivedError();

      // The scored run is selected EXACTLY as GET requirements selects
      // (M1-09 consumption pin): latest requirement-bearing (ok|flagged),
      // any prompt version.
      const latest = await extractions.findLatestRequirementBearingRun(userId, postingId);
      if (!latest) throw new PostingNotExtractedError();

      const criteriaRow = await criteria.get(userId);
      if (!criteriaRow) throw new CriteriaNotFoundError();
      // The EXACT criteria object the engine scores is also the persisted
      // snapshot (A1 — identity, not a copy).
      const criteriaData: SearchCriteriaData = {
        hardFilters: criteriaRow.hardFilters,
        positiveSignals: criteriaRow.positiveSignals,
        negativeSignals: criteriaRow.negativeSignals,
        forceLowestPriority: criteriaRow.forceLowestPriority,
        compBounds: criteriaRow.compBounds,
      };

      const requirements: ScoringRequirement[] = latest.requirements.map((row) => ({
        id: row.id,
        kind: row.kind,
        category: row.category,
        text: row.text,
        sourceQuote: row.sourceQuote,
        quoteVerified: row.quoteVerified,
        confidence: row.confidence,
        position: row.position,
      }));

      // referenceDate from the DATABASE clock (one-clock convention); the
      // engine itself never touches a clock. Built ONCE and handed to BOTH
      // engines (the A1 identity pattern — scores and classifications can
      // never disagree about their input); each zod-validates it at entry.
      const fitInput = {
        requirements,
        runStatus: latest.run.status === 'flagged' ? ('flagged' as const) : ('ok' as const),
        profile: await profile.getProfile(userId),
        criteria: criteriaData,
        referenceDate: await fitReports.currentDate(),
      };
      const report = scoreFit(fitInput);
      const gapAssignments = classifyGaps(fitInput);

      const outcome = await fitReports.persistFitReport(
        userId,
        postingId,
        latest.run.id,
        report,
        criteriaData,
        gapAssignments,
      );
      return {
        report: toWireReport(outcome.report, outcome.subScores, latest.requirements),
        postingFlipped: outcome.postingFlipped,
      };
    },

    async getReport(userId, postingId) {
      const posting = await postings.findForUser(userId, postingId);
      if (!posting) throw new PostingNotFoundError();
      const latest = await fitReports.findLatestReport(userId, postingId);
      if (!latest) return { report: null };
      // The report's OWN run's rows — after a re-extraction the latest run
      // and the scored run can differ (findRequirementsForRun exists for
      // exactly this read).
      const runRequirements = await extractions.findRequirementsForRun(
        userId,
        latest.report.extractionRunId,
      );
      return { report: toWireReport(latest.report, latest.subScores, runRequirements) };
    },

    async review(userId, reportId, notes) {
      const outcome = await fitReports.markReviewed(userId, reportId, trimmedOrNull(notes));
      if (outcome.kind === 'not_found') throw new ReportNotFoundError();
      if (outcome.kind === 'already_reviewed') throw new ReportAlreadyReviewedError();
      return {
        id: outcome.report.id,
        reviewStatus: outcome.report.reviewStatus,
        notes: outcome.report.notes,
      };
    },

    async getGaps(userId, reportId) {
      const result = await gaps.findGapsForReport(userId, reportId);
      // Missing and foreign-owned are the same 404 (user-scoped read).
      if (!result) throw new ReportNotFoundError();
      return {
        gaps: result.rows.map(toWireGap),
        lostOverrides: result.lostOverrides,
      };
    },

    async overrideGap(userId, gapId, body) {
      // A2 full replacement at the boundary: the stored note becomes
      // trimmed-or-null of the body's note on EVERY patch — absent and null
      // both clear it.
      const updated = await gaps.overrideGap(
        userId,
        gapId,
        body.classification,
        trimmedOrNull(body.note),
      );
      if (!updated) throw new GapNotFoundError();
      return toWireGap(updated);
    },
  };
}
