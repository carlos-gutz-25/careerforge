import {
  type GapClassification,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { fitReports } from '../schema/fit.ts';
import { gaps } from '../schema/gaps.ts';
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
