import {
  FIT_DIMENSIONS,
  fitReportDataSchema,
  gapAssignmentsSchema,
  searchCriteriaSchema,
  type FitReportData,
  type GapAssignment,
  type SearchCriteriaData,
} from '@careerforge/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { evidenceLinks, fitReports, fitSubScores } from '../schema/fit.ts';
import { gaps } from '../schema/gaps.ts';
import { jobPostings } from '../schema/jobs.ts';
import { bindPriorOverrides, resolveGapRows, type PriorOverriddenGap } from './gap-carry.ts';

export type FitReportRow = typeof fitReports.$inferSelect;
export type FitSubScoreRow = typeof fitSubScores.$inferSelect;
export type EvidenceLinkRow = typeof evidenceLinks.$inferSelect;
export type GapRow = typeof gaps.$inferSelect;

export interface FitSubScoreWithEvidence {
  subScore: FitSubScoreRow;
  evidence: EvidenceLinkRow[];
}

export interface FitPersistOutcome {
  report: FitReportRow;
  subScores: FitSubScoreWithEvidence[];
  /** The report's gap set as inserted (M1-11), canonical assignment order. */
  gaps: GapRow[];
  /** true iff this persist flipped the posting extracted -> scored. */
  postingFlipped: boolean;
}

export interface FitReportWithSubScores {
  report: FitReportRow;
  subScores: FitSubScoreWithEvidence[];
}

/** markReviewed's three-way outcome: the conditional update alone cannot
 *  tell a missing/foreign report (404) from an already-reviewed one (409),
 *  and the service must. */
export type FitReviewOutcome =
  { kind: 'reviewed'; report: FitReportRow } | { kind: 'already_reviewed' } | { kind: 'not_found' };

export interface FitReportsRepository {
  /**
   * ONE transaction for a whole scoring outcome (persistExtraction
   * precedent): the report row, its seven sub-score rows, every evidence
   * link, the report's GAP SET with override carry-forward resolved (M1-11),
   * then the conditional posting flip extracted -> scored (WHERE
   * status = 'extracted' only: scored stays scored on a re-score, archived
   * is never touched — unarchive semantics stay the artifact-derived law's
   * business). All-or-nothing: a fit_reports row implies its complete
   * breakdown AND its complete gap set are committed with it.
   *
   * APPEND-ONLY: a re-score inserts a new report; nothing mutates.
   *
   * Carry-forward (M1-11 A1): the source set is the posting's latest
   * EXISTING report at persist time — priorReport by (created_at desc, id
   * desc), never updated_at (R6) — and ONLY its user_overridden rows.
   * requirement_id binds first (re-score), then the D4 one-to-one
   * normalized-text match (re-extraction), via core normalizeWhitespace in
   * JS on tx-fetched rows (R1). An un-override on the prior report is
   * therefore final: older history is never consulted.
   *
   * The zod'd write path (M1-08 jsonb law): the report payload re-parses
   * through fitReportDataSchema, the snapshot through searchCriteriaSchema,
   * and the gap assignments through gapAssignmentsSchema before any row is
   * written — DB rows can only ever hold canonical shapes. criteriaSnapshot
   * is the EXACT criteria object the engine scored (A1).
   */
  persistFitReport(
    userId: string,
    postingId: string,
    extractionRunId: string,
    report: FitReportData,
    criteriaSnapshot: SearchCriteriaData,
    gapAssignments: GapAssignment[],
  ): Promise<FitPersistOutcome>;

  /** Latest report for a posting (any run), with its full breakdown —
   *  user-scoped like every read; undefined when none exists. */
  findLatestReport(userId: string, postingId: string): Promise<FitReportWithSubScores | undefined>;

  /**
   * The one-shot draft→reviewed transition (M1-10 D8): conditional UPDATE
   * pinned to review_status='draft' (the M1-02 convention — a concurrent
   * review yields zero rows, never a blind overwrite), capturing notes at
   * that moment. Report CONTENT stays append-only; reviewStatus/notes are
   * the designed mutable workflow fields ("draft-until-reviewed"). On zero
   * rows a user-scoped re-read disambiguates already_reviewed from
   * not_found (missing and foreign-owned stay the same outcome on purpose).
   */
  markReviewed(userId: string, reportId: string, notes: string | null): Promise<FitReviewOutcome>;

  /** Any fit report for the posting — the artifact-derived unarchive law's
   *  M1-10 widening (postings.service: report exists ⇒ restore 'scored'). */
  hasFitReport(userId: string, postingId: string): Promise<boolean>;

  /**
   * Today's date from the DATABASE clock as YYYY-MM-DD — the one-clock
   * convention (M1-08): scoreFit's referenceDate is caller-supplied from PG
   * now(), never the host clock. Session-TZ semantics (plan A7): now()::date
   * resolves in the server session's time zone — UTC in the dockerized
   * default — so a late-evening Central score stamps the NEXT UTC date; skew
   * is ≤1 day, seniority's day-scale math is indifferent to it, and every
   * report self-explains via the rationale's stated reference date.
   */
  currentDate(): Promise<string>;
}

/** Sub-scores in FIT_DIMENSIONS order regardless of row id/insert order. */
function byDimension(rows: FitSubScoreRow[]): FitSubScoreRow[] {
  const order = new Map(FIT_DIMENSIONS.map((dimension, index) => [dimension as string, index]));
  return [...rows].sort((a, b) => (order.get(a.dimension) ?? 99) - (order.get(b.dimension) ?? 99));
}

export function createFitReportsRepository(db: Db): FitReportsRepository {
  return {
    async persistFitReport(userId, postingId, extractionRunId, rawReport, rawSnapshot, rawGaps) {
      const report = fitReportDataSchema.parse(rawReport);
      const snapshot = searchCriteriaSchema.parse(rawSnapshot);
      const gapAssignments = gapAssignmentsSchema.parse(rawGaps);

      return db.transaction(async (tx) => {
        // A1 carry source: the posting's latest EXISTING report at persist
        // time, read BEFORE the new report row exists (created_at/id only,
        // never updated_at — R6).
        const [priorReport] = await tx
          .select({ id: fitReports.id })
          .from(fitReports)
          .where(and(eq(fitReports.userId, userId), eq(fitReports.postingId, postingId)))
          .orderBy(desc(fitReports.createdAt), desc(fitReports.id))
          .limit(1);
        const priorOverridden: PriorOverriddenGap[] = priorReport
          ? (
              await tx
                .select({
                  requirementId: gaps.requirementId,
                  requirementText: requirements.text,
                  classification: gaps.classification,
                  overrideNote: gaps.overrideNote,
                })
                .from(gaps)
                .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
                .where(and(eq(gaps.fitReportId, priorReport.id), eq(gaps.userOverridden, true)))
            ).map((row) => ({ ...row }))
          : [];

        // The new rows' requirement texts (content matching, R1: compared in
        // JS via core normalizeWhitespace).
        const runRequirements = await tx
          .select({ id: requirements.id, text: requirements.text })
          .from(requirements)
          .where(
            and(eq(requirements.userId, userId), eq(requirements.extractionRunId, extractionRunId)),
          );
        const textById = new Map(runRequirements.map((row) => [row.id, row.text]));
        const currentKeys = gapAssignments.map((assignment) => ({
          requirementId: assignment.requirementId,
          requirementText: textById.get(assignment.requirementId) ?? '',
        }));
        const binding = bindPriorOverrides(currentKeys, priorOverridden);
        const resolvedGaps = resolveGapRows(gapAssignments, binding);

        const [reportRow] = await tx
          .insert(fitReports)
          .values({
            userId,
            postingId,
            extractionRunId,
            verdict: report.verdict,
            exclusions: report.exclusions,
            criteriaSnapshot: snapshot,
            forcedLowest: report.forcedLowestPriority,
            inputFlagged: report.inputFlagged,
          })
          .returning();
        if (!reportRow) throw new Error('fit_reports insert returned no rows');

        const subScores: FitSubScoreWithEvidence[] = [];
        for (const subScore of report.subScores) {
          const [subScoreRow] = await tx
            .insert(fitSubScores)
            .values({
              userId,
              fitReportId: reportRow.id,
              dimension: subScore.dimension,
              score: subScore.score,
              rationale: subScore.rationale,
            })
            .returning();
          if (!subScoreRow) throw new Error('fit_sub_scores insert returned no rows');

          let evidence: EvidenceLinkRow[] = [];
          if (subScore.evidence.length > 0) {
            evidence = await tx
              .insert(evidenceLinks)
              .values(
                subScore.evidence.map((link) => ({
                  userId,
                  fitSubScoreId: subScoreRow.id,
                  requirementId: link.requirementId,
                  profileSkillId: link.profileSkillId,
                  profileProjectId: link.profileProjectId,
                  profileExperienceId: link.profileExperienceId,
                  postingQuote: link.postingQuote,
                  profileQuote: link.profileQuote,
                  strength: link.strength,
                })),
              )
              .returning();
          }
          subScores.push({ subScore: subScoreRow, evidence });
        }

        // The report's gap set (M1-11): carried rows keep the fresh
        // engine_classification/rationale; effective classification, note,
        // and carried_via ride the binding.
        let gapRows: GapRow[] = [];
        if (resolvedGaps.length > 0) {
          gapRows = await tx
            .insert(gaps)
            .values(
              resolvedGaps.map((row) => ({
                userId,
                fitReportId: reportRow.id,
                requirementId: row.requirementId,
                classification: row.classification,
                engineClassification: row.engineClassification,
                rationale: row.rationale,
                userOverridden: row.userOverridden,
                overrideNote: row.overrideNote,
                carriedVia: row.carriedVia,
              })),
            )
            .returning();
        }

        const [flipped] = await tx
          .update(jobPostings)
          .set({ status: 'scored' })
          .where(
            and(
              eq(jobPostings.userId, userId),
              eq(jobPostings.id, postingId),
              eq(jobPostings.status, 'extracted'),
            ),
          )
          .returning();

        return {
          report: reportRow,
          subScores,
          gaps: gapRows,
          postingFlipped: flipped !== undefined,
        };
      });
    },

    async findLatestReport(userId, postingId) {
      const [reportRow] = await db
        .select()
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.postingId, postingId)))
        .orderBy(desc(fitReports.createdAt), desc(fitReports.id))
        .limit(1);
      if (!reportRow) return undefined;

      const subScoreRows = byDimension(
        await db.select().from(fitSubScores).where(eq(fitSubScores.fitReportId, reportRow.id)),
      );
      const evidenceRows =
        subScoreRows.length === 0
          ? []
          : await db
              .select()
              .from(evidenceLinks)
              .where(
                inArray(
                  evidenceLinks.fitSubScoreId,
                  subScoreRows.map((row) => row.id),
                ),
              );
      return {
        report: reportRow,
        subScores: subScoreRows.map((subScore) => ({
          subScore,
          evidence: evidenceRows.filter((link) => link.fitSubScoreId === subScore.id),
        })),
      };
    },

    async markReviewed(userId, reportId, notes) {
      const [updated] = await db
        .update(fitReports)
        .set({ reviewStatus: 'reviewed', notes })
        .where(
          and(
            eq(fitReports.userId, userId),
            eq(fitReports.id, reportId),
            eq(fitReports.reviewStatus, 'draft'),
          ),
        )
        .returning();
      if (updated) return { kind: 'reviewed', report: updated };

      const [existing] = await db
        .select({ id: fitReports.id })
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.id, reportId)))
        .limit(1);
      return existing ? { kind: 'already_reviewed' } : { kind: 'not_found' };
    },

    async hasFitReport(userId, postingId) {
      const [row] = await db
        .select({ id: fitReports.id })
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.postingId, postingId)))
        .limit(1);
      return row !== undefined;
    },

    async currentDate() {
      const result = await db.execute<{ today: string }>(sql`select now()::date::text as today`);
      const today = result.rows[0]?.today;
      if (!today) throw new Error('now()::date returned no row');
      return today;
    },
  };
}
