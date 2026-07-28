import {
  type EvidenceStrength,
  type FitReviewStatus,
  type FitVerdict,
  type GapClassification,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { evidenceLinks, fitReports, fitSubScores } from '../schema/fit.ts';
import { gaps } from '../schema/gaps.ts';
import { jobPostings } from '../schema/jobs.ts';
import { type FitReportRow, type GapRow } from './fit-reports.repository.ts';
import { bindPriorOverrides, type PriorOverriddenGap } from './gap-carry.ts';

// M1-11 gap reads + the override write (plan rider R2: this repository owns
// findGapsForReport/overrideGap; carry RESOLUTION lives inside
// persistFitReport's transaction in fit-reports.repository).

/** One gap row with its requirement's display fields (the wire join). */
export interface GapWithRequirement {
  gap: GapRow;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
}

/**
 * A gap selected BY ID for a learning plan (M3-01), carrying the two facts
 * cross-posting selection needs beyond the requirement display fields:
 * `postingId` (its source report's posting — the DISTINCT-postings key for the
 * syntactic recurrence count) and `reportReviewStatus` (the source fit
 * report's review status — the learning-plan draft requires EVERY selected
 * gap's report be reviewed, the multi-report analog of the improvement-plan
 * single-report gate). The gap's own `fitReportId`/`requirementId` are on
 * `gap`. Foreign-owned/unknown ids simply do not appear (user-scoped read);
 * the SERVICE compares the returned set against the request to 404 the rest.
 */
export interface GapForSelection {
  gap: GapRow;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
  postingId: string;
  reportReviewStatus: FitReportRow['reviewStatus'];
}

/**
 * One gap's requirement for the M3-06 upgrade matcher: the gap id, its
 * requirement id, and the two fields the deterministic matcher tokenizes
 * (`text` + `sourceQuote` — the exact fit-engine haystack, prepare.ts parity).
 * No display kind/category here — this feeds matching, not rendering.
 */
export interface GapRequirement {
  gapId: string;
  requirementId: string;
  text: string;
  sourceQuote: string;
}

/**
 * One requirement instance feeding the M9-02 market-signal aggregator: a gap on a
 * posting's LATEST fit report, its requirement display fields, the report verdict/
 * review status, and this requirement's evidence-link strengths on that report ([]
 * when none). Structurally the scoring MarketSignalInstance - the service passes it
 * straight through (the call site is the compile-time pin). Latest-report-only,
 * non-archived, user-scoped (D9).
 */
export interface MarketSignalRow {
  postingId: string;
  fitReportId: string;
  reportVerdict: FitVerdict;
  reportReviewStatus: FitReviewStatus;
  gapId: string;
  requirementId: string;
  requirementText: string;
  kind: RequirementKind;
  category: RequirementCategory;
  classification: GapClassification;
  userOverridden: boolean;
  evidenceStrengths: EvidenceStrength[];
}

/**
 * The D5 cohort disclosure counts (everything EXCEPT postingsWithSignal, which the
 * service derives from the returned rows - the honest "distinct postings that
 * actually contributed"). All computed over the user's non-archived postings and
 * the LATEST report per posting.
 */
export interface MarketSignalCohortCounts {
  postingsConsidered: number;
  postingsWithoutReport: number;
  postingsArchived: number;
  excludedVerdictPostings: number;
  draftReports: number;
  reviewedReports: number;
  unscoredRequirementsInCohort: number;
}

export interface GapsForReport {
  rows: GapWithRequirement[];
  /**
   * The immediately prior report's overridden rows that bind to NO row of
   * this report — computed with the SAME bindPriorOverrides as the write
   * path (A1: read is the exact complement of write). Prior report =
   * next-lower (created_at, id) for the same posting, never updated_at (R6).
   */
  lostOverrides: number;
}

export interface GapsRepository {
  /**
   * The gap set of ONE report (report-scoped, ARCHITECTURE §5), rows in
   * canonical (position, id) order, or undefined when the report is missing
   * or foreign-owned (one 404 outcome, the user-scoped read law). A report
   * persisted before migration 0006 has zero rows and serves
   * `{ rows: [], lostOverrides: 0 }` — empty-by-design (R3).
   */
  findGapsForReport(userId: string, reportId: string): Promise<GapsForReport | undefined>;

  /**
   * Gaps selected BY ID across postings for a learning plan (M3-01). Returns
   * only the caller's own gaps that exist, each joined to its requirement
   * display fields, its posting id, and its source report's review status;
   * order is deterministic (created_at, id) so recurrence tie-breaks are
   * stable. Ids the caller does not own (or that do not exist) are simply
   * absent — the service diffs the returned ids against the request to 404.
   */
  findGapsByIds(userId: string, gapIds: readonly string[]): Promise<GapForSelection[]>;

  /** The requirements behind a set of gaps (owner-scoped), for the M3-06
   *  upgrade-suggestion matcher — text + sourceQuote per gap. Foreign/unknown
   *  gap ids simply do not appear (user-scoped read); empty list for empty input. */
  findRequirementsByGapIds(userId: string, gapIds: readonly string[]): Promise<GapRequirement[]>;

  /**
   * M9-02 market-signal instances: every gap on the LATEST fit report of each of
   * the user's NON-archived postings, joined to its requirement + its evidence
   * strengths, in deterministic (posting.createdAt, posting.id, requirement.position,
   * requirement.id) order. User-scoped on every table; latest-report-only (older
   * superseded reports' gaps are invisible). Empty list when the user has none.
   */
  listMarketSignalRows(userId: string): Promise<MarketSignalRow[]>;

  /** M9-02 cohort disclosure counts (D5) over the user's non-archived postings and
   *  each posting's latest report. */
  countMarketSignalCohort(userId: string): Promise<MarketSignalCohortCounts>;

  /**
   * The override write (M1-11 D6/D7, A2 FULL REPLACEMENT): a bucket value
   * sets classification + user_overridden=true + override_note=note; null
   * classification is the un-override — classification reverts to the row's
   * engine_classification, user_overridden=false, note cleared. BOTH paths
   * clear carried_via (NULL = direct user PATCH) and REPLACE the note with
   * the argument (never merged). Plain user-scoped UPDATE, re-editable by
   * design (D7 — no CAS); undefined on missing/foreign.
   */
  overrideGap(
    userId: string,
    gapId: string,
    classification: GapClassification | null,
    note: string | null,
  ): Promise<GapWithRequirement | undefined>;
}

/** Narrow read-only view for the M3-06 skill-upgrades module: the one gap read
 *  it needs (the requirement text/quote behind cited gaps). Read-only by type. */
export type GapRequirementRead = Pick<GapsRepository, 'findRequirementsByGapIds'>;

export function createGapsRepository(db: Db): GapsRepository {
  async function joinRequirement(gap: GapRow): Promise<GapWithRequirement | undefined> {
    const [requirement] = await db
      .select({ text: requirements.text, kind: requirements.kind, category: requirements.category })
      .from(requirements)
      .where(eq(requirements.id, gap.requirementId))
      .limit(1);
    if (!requirement) return undefined;
    return {
      gap,
      requirementText: requirement.text,
      requirementKind: requirement.kind,
      requirementCategory: requirement.category,
    };
  }

  return {
    async findGapsForReport(userId, reportId) {
      const [report] = await db
        .select({
          id: fitReports.id,
          postingId: fitReports.postingId,
          createdAt: fitReports.createdAt,
        })
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.id, reportId)))
        .limit(1);
      if (!report) return undefined;

      const joined = await db
        .select({
          gap: gaps,
          requirementText: requirements.text,
          requirementKind: requirements.kind,
          requirementCategory: requirements.category,
        })
        .from(gaps)
        .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
        .where(eq(gaps.fitReportId, report.id))
        .orderBy(asc(requirements.position), asc(requirements.id));

      const [priorReport] = await db
        .select({ id: fitReports.id })
        .from(fitReports)
        .where(
          and(
            eq(fitReports.userId, userId),
            eq(fitReports.postingId, report.postingId),
            or(
              lt(fitReports.createdAt, report.createdAt),
              and(eq(fitReports.createdAt, report.createdAt), lt(fitReports.id, report.id)),
            ),
          ),
        )
        .orderBy(desc(fitReports.createdAt), desc(fitReports.id))
        .limit(1);

      let lostOverrides = 0;
      if (priorReport) {
        const priorOverridden: PriorOverriddenGap[] = await db
          .select({
            requirementId: gaps.requirementId,
            requirementText: requirements.text,
            classification: gaps.classification,
            overrideNote: gaps.overrideNote,
          })
          .from(gaps)
          .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
          .where(and(eq(gaps.fitReportId, priorReport.id), eq(gaps.userOverridden, true)));
        const currentKeys = joined.map((row) => ({
          requirementId: row.gap.requirementId,
          requirementText: row.requirementText,
        }));
        lostOverrides = bindPriorOverrides(currentKeys, priorOverridden).lostOverrides;
      }

      return { rows: joined, lostOverrides };
    },

    async findGapsByIds(userId, gapIds) {
      if (gapIds.length === 0) return [];
      const rows = await db
        .select({
          gap: gaps,
          requirementText: requirements.text,
          requirementKind: requirements.kind,
          requirementCategory: requirements.category,
          postingId: fitReports.postingId,
          reportReviewStatus: fitReports.reviewStatus,
        })
        .from(gaps)
        .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
        .innerJoin(fitReports, eq(fitReports.id, gaps.fitReportId))
        .where(and(eq(gaps.userId, userId), inArray(gaps.id, [...gapIds])))
        .orderBy(asc(gaps.createdAt), asc(gaps.id));
      return rows;
    },

    async findRequirementsByGapIds(userId, gapIds) {
      if (gapIds.length === 0) return [];
      const rows = await db
        .select({
          gapId: gaps.id,
          requirementId: gaps.requirementId,
          text: requirements.text,
          sourceQuote: requirements.sourceQuote,
        })
        .from(gaps)
        .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
        .where(and(eq(gaps.userId, userId), inArray(gaps.id, [...gapIds])))
        .orderBy(asc(gaps.id));
      return rows;
    },

    async listMarketSignalRows(userId) {
      // Gaps whose report is the LATEST report for its (non-archived) posting - the
      // findLatestReport (created_at desc, id desc) ordering, applied per posting via
      // a correlated subquery so many-postings collapse to one report each.
      const gapRows = await db
        .select({
          postingId: fitReports.postingId,
          fitReportId: gaps.fitReportId,
          reportVerdict: fitReports.verdict,
          reportReviewStatus: fitReports.reviewStatus,
          gapId: gaps.id,
          requirementId: gaps.requirementId,
          requirementText: requirements.text,
          kind: requirements.kind,
          category: requirements.category,
          classification: gaps.classification,
          userOverridden: gaps.userOverridden,
        })
        .from(gaps)
        .innerJoin(fitReports, eq(fitReports.id, gaps.fitReportId))
        .innerJoin(jobPostings, eq(jobPostings.id, fitReports.postingId))
        .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
        .where(
          and(
            eq(gaps.userId, userId),
            ne(jobPostings.status, 'archived'),
            sql`${fitReports.id} = (select fr2.id from fit_reports fr2 where fr2.posting_id = ${fitReports.postingId} and fr2.user_id = ${userId} order by fr2.created_at desc, fr2.id desc limit 1)`,
          ),
        )
        .orderBy(
          asc(jobPostings.createdAt),
          asc(jobPostings.id),
          asc(requirements.position),
          asc(requirements.id),
        );

      // Evidence strengths per (report, requirement): join evidence_links to its
      // sub-score's report. Deterministic order so the strengths array is stable.
      const reportIds = [...new Set(gapRows.map((row) => row.fitReportId))];
      const evidenceRows =
        reportIds.length === 0
          ? []
          : await db
              .select({
                fitReportId: fitSubScores.fitReportId,
                requirementId: evidenceLinks.requirementId,
                strength: evidenceLinks.strength,
                linkId: evidenceLinks.id,
              })
              .from(evidenceLinks)
              .innerJoin(fitSubScores, eq(fitSubScores.id, evidenceLinks.fitSubScoreId))
              .where(
                and(eq(evidenceLinks.userId, userId), inArray(fitSubScores.fitReportId, reportIds)),
              )
              .orderBy(
                asc(fitSubScores.fitReportId),
                asc(evidenceLinks.requirementId),
                asc(evidenceLinks.strength),
                asc(evidenceLinks.id),
              );

      const strengthsByKey = new Map<string, EvidenceStrength[]>();
      for (const row of evidenceRows) {
        const key = `${row.fitReportId}::${row.requirementId}`;
        const list = strengthsByKey.get(key);
        if (list) list.push(row.strength);
        else strengthsByKey.set(key, [row.strength]);
      }

      return gapRows.map((row) => ({
        postingId: row.postingId,
        fitReportId: row.fitReportId,
        reportVerdict: row.reportVerdict,
        reportReviewStatus: row.reportReviewStatus,
        gapId: row.gapId,
        requirementId: row.requirementId,
        requirementText: row.requirementText,
        kind: row.kind,
        category: row.category,
        classification: row.classification,
        userOverridden: row.userOverridden,
        evidenceStrengths: strengthsByKey.get(`${row.fitReportId}::${row.requirementId}`) ?? [],
      }));
    },

    async countMarketSignalCohort(userId) {
      // Non-archived vs archived posting counts (one grouped scan).
      const statusCounts = await db
        .select({ status: jobPostings.status, count: sql<number>`count(*)::int` })
        .from(jobPostings)
        .where(eq(jobPostings.userId, userId))
        .groupBy(jobPostings.status);
      let postingsConsidered = 0;
      let postingsArchived = 0;
      for (const row of statusCounts) {
        if (row.status === 'archived') postingsArchived += row.count;
        else postingsConsidered += row.count;
      }

      // The LATEST report per non-archived posting (the consumed set).
      const latest = await db.execute<{
        verdict: FitVerdict;
        review_status: FitReviewStatus;
        extraction_run_id: string;
      }>(sql`
        select distinct on (fr.posting_id) fr.verdict, fr.review_status, fr.extraction_run_id
        from fit_reports fr
        join job_postings jp on jp.id = fr.posting_id
        where fr.user_id = ${userId} and jp.status <> 'archived'
        order by fr.posting_id, fr.created_at desc, fr.id desc
      `);
      const latestReports = latest.rows;
      const postingsWithReport = latestReports.length;
      let excludedVerdictPostings = 0;
      let draftReports = 0;
      let reviewedReports = 0;
      for (const report of latestReports) {
        if (report.verdict === 'excluded') excludedVerdictPostings += 1;
        if (report.review_status === 'draft') draftReports += 1;
        else reviewedReports += 1;
      }

      // Requirements on the consumed reports' runs that never received a gap (the
      // classify-gaps eligibility law: only quoteVerified === true is eligible).
      const runIds = [...new Set(latestReports.map((report) => report.extraction_run_id))];
      let unscoredRequirementsInCohort = 0;
      if (runIds.length > 0) {
        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(requirements)
          .where(
            and(
              eq(requirements.userId, userId),
              inArray(requirements.extractionRunId, runIds),
              sql`${requirements.quoteVerified} is distinct from true`,
            ),
          );
        unscoredRequirementsInCohort = row?.count ?? 0;
      }

      return {
        postingsConsidered,
        postingsWithoutReport: postingsConsidered - postingsWithReport,
        postingsArchived,
        excludedVerdictPostings,
        draftReports,
        reviewedReports,
        unscoredRequirementsInCohort,
      };
    },

    async overrideGap(userId, gapId, classification, note) {
      const scope = and(eq(gaps.userId, userId), eq(gaps.id, gapId));
      const [updated] =
        classification !== null
          ? await db
              .update(gaps)
              .set({
                classification,
                userOverridden: true,
                overrideNote: note,
                carriedVia: null,
              })
              .where(scope)
              .returning()
          : await db
              .update(gaps)
              .set({
                classification: sql`${gaps.engineClassification}`,
                userOverridden: false,
                overrideNote: null,
                carriedVia: null,
              })
              .where(scope)
              .returning();
      if (!updated) return undefined;
      return joinRequirement(updated);
    },
  };
}
