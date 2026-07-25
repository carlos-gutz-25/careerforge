import {
  type EvidenceStrength,
  type GapClassification,
  type InterviewQuestionKind,
  type PlanDraftingRunStatus,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { evidenceLinks, fitReports, fitSubScores } from '../schema/fit.ts';
import { gaps } from '../schema/gaps.ts';
import {
  interviewPrepPoints,
  interviewPrepQuestions,
  interviewPrepRuns,
  interviewPreps,
} from '../schema/interview.ts';
import { jobPostings } from '../schema/jobs.ts';
import { type FitReportRow } from './fit-reports.repository.ts';

// M3-04: interview-prep persistence + reads. A prep is an append-only
// artifact of exactly ONE fit report (pin-to-report; UNIQUE fit_report_id —
// the M1-12 pattern, NOT ADR-0013 free-create), reached through the POSTING
// (the service resolves the posting's LATEST report). The audit table
// records one row per WIRE CALL (the M1-05 law at its fourth call site); the
// prep row + its complete question/point tree are created only from an ok,
// tripwire-clean run in the SAME transaction. Every query is user-scoped
// (ADR-0007).

export type InterviewPrepRunRow = typeof interviewPrepRuns.$inferSelect;
export type InterviewPrepRow = typeof interviewPreps.$inferSelect;
export type InterviewPrepQuestionRow = typeof interviewPrepQuestions.$inferSelect;
export type InterviewPrepPointRow = typeof interviewPrepPoints.$inferSelect;

/** One wire call's audit row (the PlanDraftingRunInsert twin). The SERVICE
 *  maps packages/llm's LlmCallRecord into this shape. */
export interface InterviewPrepRunInsert {
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
   *  persistDraftingOutcome through deriveInterviewRunStatus (citation +
   *  disclosure tripwires), never inserted from outside. */
  status: Exclude<PlanDraftingRunStatus, 'flagged'>;
  /** LlmCallRecord.timestamp (the runner's now-seam clock, F3). */
  createdAt: Date;
}

/** One typed point to persist. The service has already mapped model output
 *  to server-resolved ids (evidence link / gap) — exactly the FK matching
 *  the type is set (the schema CHECK enforces it at rest). Position is
 *  assigned from array order. */
export type InterviewPointInsert =
  | { type: 'evidence'; evidenceLinkId: string; text: string }
  | { type: 'gap_disclosure'; gapId: string; text: string };

/** One drafted question with its points; question position and point
 *  positions are assigned from array order. */
export interface InterviewQuestionInsert {
  requirementId: string;
  kind: InterviewQuestionKind;
  question: string;
  points: InterviewPointInsert[];
}

/** A verified-filter input row for the drafting payload: the report's
 *  extraction-run requirements each carrying its gap row on THIS report when
 *  one exists (LEFT JOIN — gap is 1:0..1 per (report, requirement); absent =
 *  no classification, gate condition 2). quoteVerified stays tri-state here;
 *  the payload builder applies the strict === true filter (condition 1). */
export interface InterviewRequirementRow {
  requirementId: string;
  quoteVerified: boolean | null;
  text: string;
  kind: RequirementKind;
  category: RequirementCategory;
  gapId: string | null;
  gapClassification: GapClassification | null;
}

/** Evidence rows for the drafting payload (requirement-keyed via the
 *  report's sub-scores), WITH ids — the point rows FK the cited link.
 *  Quotes are posting/profile-derived: untrusted payload data, never
 *  logged. */
export interface InterviewEvidenceRow {
  evidenceLinkId: string;
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

/** One point with its citation's LIVE display fields joined per row: evidence
 *  fields for 'evidence' points, the gap's CURRENT classification for
 *  'gap_disclosure' points (the server-anchored badge, gate condition 3 — it
 *  can legitimately diverge from the draft-time value after a later
 *  override, the M1-12 residual). The non-matching side is null. */
export interface InterviewPointWithDisplay {
  point: InterviewPrepPointRow;
  evidenceStrength: EvidenceStrength | null;
  evidencePostingQuote: string | null;
  evidenceProfileQuote: string | null;
  gapClassification: GapClassification | null;
}

/** One question with its requirement's display fields and its points in
 *  (position, id) order. */
export interface InterviewQuestionWithPoints {
  question: InterviewPrepQuestionRow;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
  points: InterviewPointWithDisplay[];
}

export interface PrepWithQuestions {
  prep: InterviewPrepRow;
  /** The prep's OWN drafting run (via drafting_run_id — the M1-12 R2
   *  run-selection contract; never latest-by-time when a prep exists). */
  run: InterviewPrepRunRow;
  /** Canonical (position, id) order. */
  questions: InterviewQuestionWithPoints[];
}

export interface InterviewPersistOutcome {
  runs: InterviewPrepRunRow[];
  /** true iff THIS persist created the prep row. */
  prepCreated: boolean;
  /** true iff the prep insert hit the UNIQUE (a concurrent draft won the
   *  race). The runs are still committed — both wire calls happened and both
   *  are recorded (the improvement-plan ON CONFLICT DO NOTHING precedent). */
  conflicted: boolean;
}

/** markPrepReviewed's three-way outcome (the markPlanReviewed mirror). */
export type InterviewPrepReviewOutcome =
  | { kind: 'reviewed'; prep: InterviewPrepRow }
  | { kind: 'already_reviewed' }
  | { kind: 'not_found' };

/**
 * The single policy site for the post-hoc 'flagged' status (the
 * derivePlanRunStatus twin): an ok run that failed EITHER M3-04 tripwire —
 * citation (a requirement/evidence ref never sent, or evidence cited across
 * requirements) or disclosure (BIDIRECTIONAL: an obliged question missing
 * its gap_disclosure, or a spurious disclosure on an unobliged requirement)
 * — is flagged AT INSERT TIME. Non-ok statuses pass through untouched.
 */
export function deriveInterviewRunStatus(
  status: Exclude<PlanDraftingRunStatus, 'flagged'>,
  tripwireFailed: boolean,
): PlanDraftingRunStatus {
  return status === 'ok' && tripwireFailed ? 'flagged' : status;
}

export interface InterviewPrepsRepository {
  /** Posting existence probe (404 anchor); missing and foreign-owned are one
   *  outcome. Meta only — raw_text never leaves the row. */
  findPostingId(userId: string, postingId: string): Promise<string | undefined>;

  /** The posting's LATEST fit report by (created_at, id) — the pin-to-report
   *  anchor the posting-scoped routes resolve through. */
  findLatestReportForPosting(userId: string, postingId: string): Promise<FitReportRow | undefined>;

  /** The report's extraction-run requirements in (position, id) order, each
   *  LEFT-JOINed with its gap row on THIS report (absent gap = null fields).
   *  Tri-state quoteVerified passes through — the payload builder filters. */
  findRequirementsForReport(userId: string, reportId: string): Promise<InterviewRequirementRow[]>;

  /** Evidence links of the report's sub-scores (requirement-keyed, with ids),
   *  for the drafting payload and the point FKs. */
  findEvidenceForReport(userId: string, reportId: string): Promise<InterviewEvidenceRow[]>;

  /**
   * ONE transaction for a whole drafting outcome (the persistDraftingOutcome
   * precedent): every wire-call audit row always; the prep row + its complete
   * question/point tree ONLY when `questions` is provided — the caller's
   * contract is that `questions` implies the final run is ok and
   * tripwire-clean (both directions). The final run's stored status passes
   * through deriveInterviewRunStatus (tripwireFailed=true ⇒ 'flagged', no
   * prep row, nothing reaches the DB). The prep insert is ON CONFLICT DO
   * NOTHING on fit_report_id: a lost concurrent race commits the runs and
   * reports `conflicted` instead of aborting. APPEND-ONLY: nothing mutates;
   * question/point position = array order.
   */
  persistDraftingOutcome(
    userId: string,
    fitReportId: string,
    runs: InterviewPrepRunInsert[],
    tripwireFailed: boolean,
    questions: InterviewQuestionInsert[] | undefined,
  ): Promise<InterviewPersistOutcome>;

  /** The report's prep with its drafting run and joined question/point tree,
   *  or undefined when no prep exists. */
  findPrepForReport(userId: string, fitReportId: string): Promise<PrepWithQuestions | undefined>;

  /** The prep by id with the same joined tree (the review response's
   *  re-read anchor is meta-only, but GET-by-report is the canonical read —
   *  this exists for the review route's ownership probe). */
  findPrepMeta(userId: string, prepId: string): Promise<InterviewPrepRow | undefined>;

  /** Latest drafting run for the report by (created_at, id) — the GET's
   *  failure-display read, used ONLY when no prep exists (R2). */
  findLatestRunForReport(
    userId: string,
    fitReportId: string,
  ): Promise<InterviewPrepRunRow | undefined>;

  /** The one-shot draft→reviewed transition (the markPlanReviewed mirror):
   *  conditional UPDATE pinned to review_status='draft'; on zero rows a
   *  user-scoped re-read disambiguates already_reviewed from not_found. */
  markPrepReviewed(
    userId: string,
    prepId: string,
    notes: string | null,
  ): Promise<InterviewPrepReviewOutcome>;
}

export function createInterviewPrepsRepository(db: Db): InterviewPrepsRepository {
  return {
    async findPostingId(userId, postingId) {
      const [row] = await db
        .select({ id: jobPostings.id })
        .from(jobPostings)
        .where(and(eq(jobPostings.userId, userId), eq(jobPostings.id, postingId)))
        .limit(1);
      return row?.id;
    },

    async findLatestReportForPosting(userId, postingId) {
      const [report] = await db
        .select()
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.postingId, postingId)))
        .orderBy(desc(fitReports.createdAt), desc(fitReports.id))
        .limit(1);
      return report;
    },

    async findRequirementsForReport(userId, reportId) {
      return db
        .select({
          requirementId: requirements.id,
          quoteVerified: requirements.quoteVerified,
          text: requirements.text,
          kind: requirements.kind,
          category: requirements.category,
          gapId: gaps.id,
          gapClassification: gaps.classification,
        })
        .from(requirements)
        .innerJoin(fitReports, eq(fitReports.extractionRunId, requirements.extractionRunId))
        .leftJoin(
          gaps,
          and(eq(gaps.fitReportId, fitReports.id), eq(gaps.requirementId, requirements.id)),
        )
        .where(and(eq(requirements.userId, userId), eq(fitReports.id, reportId)))
        .orderBy(asc(requirements.position), asc(requirements.id));
    },

    async findEvidenceForReport(userId, reportId) {
      return db
        .select({
          evidenceLinkId: evidenceLinks.id,
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

    async persistDraftingOutcome(userId, fitReportId, runs, tripwireFailed, questions) {
      if (runs.length === 0) throw new Error('persistDraftingOutcome requires at least one run');
      const finalIndex = runs.length - 1;

      return db.transaction(async (tx) => {
        const runRows: InterviewPrepRunRow[] = [];
        for (const [index, run] of runs.entries()) {
          const [runRow] = await tx
            .insert(interviewPrepRuns)
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
                index === finalIndex
                  ? deriveInterviewRunStatus(run.status, tripwireFailed)
                  : run.status,
              createdAt: run.createdAt,
            })
            .returning();
          if (!runRow) throw new Error('interview_prep_runs insert returned no rows');
          runRows.push(runRow);
        }

        const finalRun = runRows[finalIndex];
        if (!finalRun) throw new Error('unreachable: runs is non-empty');

        let prepCreated = false;
        let conflicted = false;
        if (questions !== undefined) {
          if (finalRun.status !== 'ok') {
            throw new Error('prep questions require an ok, tripwire-clean final run');
          }
          const [prepRow] = await tx
            .insert(interviewPreps)
            .values({ userId, fitReportId, draftingRunId: finalRun.id })
            .onConflictDoNothing({ target: interviewPreps.fitReportId })
            .returning();
          if (prepRow) {
            prepCreated = true;
            for (const [position, question] of questions.entries()) {
              const [questionRow] = await tx
                .insert(interviewPrepQuestions)
                .values({
                  userId,
                  interviewPrepId: prepRow.id,
                  requirementId: question.requirementId,
                  kind: question.kind,
                  question: question.question,
                  position,
                })
                .returning();
              if (!questionRow) throw new Error('interview_prep_questions insert returned no rows');
              if (question.points.length > 0) {
                await tx.insert(interviewPrepPoints).values(
                  question.points.map((point, pointPosition) => ({
                    userId,
                    interviewPrepQuestionId: questionRow.id,
                    type: point.type,
                    evidenceLinkId: point.type === 'evidence' ? point.evidenceLinkId : null,
                    gapId: point.type === 'gap_disclosure' ? point.gapId : null,
                    text: point.text,
                    position: pointPosition,
                  })),
                );
              }
            }
          } else {
            conflicted = true;
          }
        }

        return { runs: runRows, prepCreated, conflicted };
      });
    },

    async findPrepForReport(userId, fitReportId) {
      const [prepRow] = await db
        .select()
        .from(interviewPreps)
        .where(and(eq(interviewPreps.userId, userId), eq(interviewPreps.fitReportId, fitReportId)))
        .limit(1);
      if (!prepRow) return undefined;

      const [runRow] = await db
        .select()
        .from(interviewPrepRuns)
        .where(eq(interviewPrepRuns.id, prepRow.draftingRunId))
        .limit(1);
      if (!runRow) throw new Error('interview prep has no drafting run (FK violated?)');

      const questionRows = await db
        .select({
          question: interviewPrepQuestions,
          requirementText: requirements.text,
          requirementKind: requirements.kind,
          requirementCategory: requirements.category,
        })
        .from(interviewPrepQuestions)
        .innerJoin(requirements, eq(requirements.id, interviewPrepQuestions.requirementId))
        .where(eq(interviewPrepQuestions.interviewPrepId, prepRow.id))
        .orderBy(asc(interviewPrepQuestions.position), asc(interviewPrepQuestions.id));

      const questionIds = questionRows.map((row) => row.question.id);
      const pointRows =
        questionIds.length === 0
          ? []
          : await db
              .select({
                point: interviewPrepPoints,
                evidenceStrength: evidenceLinks.strength,
                evidencePostingQuote: evidenceLinks.postingQuote,
                evidenceProfileQuote: evidenceLinks.profileQuote,
                gapClassification: gaps.classification,
              })
              .from(interviewPrepPoints)
              .leftJoin(evidenceLinks, eq(evidenceLinks.id, interviewPrepPoints.evidenceLinkId))
              .leftJoin(gaps, eq(gaps.id, interviewPrepPoints.gapId))
              .where(inArray(interviewPrepPoints.interviewPrepQuestionId, questionIds))
              .orderBy(asc(interviewPrepPoints.position), asc(interviewPrepPoints.id));

      const pointsByQuestion = new Map<string, InterviewPointWithDisplay[]>();
      for (const row of pointRows) {
        const list = pointsByQuestion.get(row.point.interviewPrepQuestionId);
        if (list) list.push(row);
        else pointsByQuestion.set(row.point.interviewPrepQuestionId, [row]);
      }

      return {
        prep: prepRow,
        run: runRow,
        questions: questionRows.map((row) => ({
          question: row.question,
          requirementText: row.requirementText,
          requirementKind: row.requirementKind,
          requirementCategory: row.requirementCategory,
          points: pointsByQuestion.get(row.question.id) ?? [],
        })),
      };
    },

    async findPrepMeta(userId, prepId) {
      const [row] = await db
        .select()
        .from(interviewPreps)
        .where(and(eq(interviewPreps.userId, userId), eq(interviewPreps.id, prepId)))
        .limit(1);
      return row;
    },

    async findLatestRunForReport(userId, fitReportId) {
      const [runRow] = await db
        .select()
        .from(interviewPrepRuns)
        .where(
          and(eq(interviewPrepRuns.userId, userId), eq(interviewPrepRuns.fitReportId, fitReportId)),
        )
        .orderBy(desc(interviewPrepRuns.createdAt), desc(interviewPrepRuns.id))
        .limit(1);
      return runRow;
    },

    async markPrepReviewed(userId, prepId, notes) {
      const [updated] = await db
        .update(interviewPreps)
        .set({ reviewStatus: 'reviewed', notes })
        .where(
          and(
            eq(interviewPreps.userId, userId),
            eq(interviewPreps.id, prepId),
            eq(interviewPreps.reviewStatus, 'draft'),
          ),
        )
        .returning();
      if (updated) return { kind: 'reviewed', prep: updated };

      const [existing] = await db
        .select({ id: interviewPreps.id })
        .from(interviewPreps)
        .where(and(eq(interviewPreps.userId, userId), eq(interviewPreps.id, prepId)))
        .limit(1);
      return existing ? { kind: 'already_reviewed' } : { kind: 'not_found' };
    },
  };
}
