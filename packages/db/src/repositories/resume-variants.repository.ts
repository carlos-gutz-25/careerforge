import {
  type EvidenceStrength,
  type GapClassification,
  type RequirementCategory,
  type RequirementKind,
  type ResumeEmphasisLevel,
  type ResumeEntityType,
  type ResumeVariantRunStatus,
} from '@careerforge/core';
import { and, asc, eq, desc, inArray } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { evidenceLinks, fitReports, fitSubScores } from '../schema/fit.ts';
import { gaps } from '../schema/gaps.ts';
import {
  resumeVariantCitations,
  resumeVariantEntries,
  resumeVariantRuns,
  resumeVariants,
} from '../schema/resume.ts';
import { type FitReportRow } from './fit-reports.repository.ts';

// M2-10: resume-variant persistence + reads. A variant is an append-only
// artifact of exactly ONE fit report (pin-to-report; UNIQUE fit_report_id);
// the audit table records one row per WIRE CALL (the M1-05 law at its third
// call site); the variant row is created only from an ok, spec-valid run in
// the SAME transaction as its entries + citations. Positions are
// server-assigned by the caller (skills/projects spec order, experiences DB
// chronological); the model has no experience-order field (ADR-0012).

export type ResumeVariantRunRow = typeof resumeVariantRuns.$inferSelect;
export type ResumeVariantRow = typeof resumeVariants.$inferSelect;
export type ResumeVariantEntryRow = typeof resumeVariantEntries.$inferSelect;
export type ResumeVariantCitationRow = typeof resumeVariantCitations.$inferSelect;

/** One wire call's audit row. The SERVICE maps packages/llm's LlmCallRecord
 *  into this shape (flattened usage, timestamp → createdAt) — this package's
 *  only internal dependency stays @careerforge/core. */
export interface ResumeVariantRunInsert {
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
   *  persistTailoringOutcome derives it internally through the single policy
   *  site deriveResumeRunStatus (spec validation, the M1-12 pattern). */
  status: Exclude<ResumeVariantRunStatus, 'flagged'>;
  /** LlmCallRecord.timestamp (the runner's now-seam clock, F3). */
  createdAt: Date;
}

/** One rendered entry to persist. position is server-assigned upstream (the
 *  render slot within its section); label/detail are durable display SNAPSHOTS
 *  (frozen so a later re-import cannot mutate a reviewed artifact); the profile
 *  FKs are navigation only (SET NULL on re-import). citations are attached by
 *  array order. */
export interface ResumeVariantEntryInsert {
  section: ResumeEntityType;
  position: number;
  profileSkillId: string | null;
  profileProjectId: string | null;
  profileExperienceId: string | null;
  label: string;
  detail: string | null;
  emphasis: ResumeEmphasisLevel | null;
  reason: string | null;
  /** Gap refs the emphasis cites; [] iff emphasis is null. position assigned
   *  from array order. */
  citationGapIds: string[];
}

/** The variant payload for a valid outcome: the rendered snapshot + the full
 *  ordered entry set. Provided to persistTailoringOutcome ONLY when the final
 *  run is ok and the spec validated. */
export interface ResumeVariantInsert {
  renderedMarkdown: string;
  entries: ResumeVariantEntryInsert[];
}

/** One cited gap's display fields (the wire join). gapClassification is the
 *  gap's LIVE effective value at read time — it can legitimately diverge from
 *  the draft-time value after a later override (the named M1-12 residual). */
export interface CitationWithGap {
  citation: ResumeVariantCitationRow;
  gapClassification: GapClassification;
  requirementId: string;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
}

export interface VariantEntryWithCitations {
  entry: ResumeVariantEntryRow;
  /** Canonical (position, id) order. */
  citations: CitationWithGap[];
}

export interface VariantWithEntries {
  variant: ResumeVariantRow;
  /** The variant's tailoring run (via tailoring_run_id — the R2 run-selection
   *  contract; never latest-by-time when a variant exists). */
  run: ResumeVariantRunRow;
  /** Canonical (section, position, id) order. */
  entries: VariantEntryWithCitations[];
}

export interface TailoringPersistOutcome {
  runs: ResumeVariantRunRow[];
  /** true iff THIS persist created the variant row. */
  variantCreated: boolean;
  /**
   * true iff the variant insert hit the UNIQUE (a concurrent draft won the
   * race). The runs are still committed — both wire calls happened and both
   * are recorded (honest telemetry; the M1-12 double-POST residual, resolved
   * here by ON CONFLICT DO NOTHING instead of an aborted transaction).
   */
  conflicted: boolean;
}

/** Evidence rows for the tailoring payload, keyed by requirement (via the
 *  report's sub-scores). The M1-12 delta: rows carry the three profile-entity
 *  FK ids so the payload builder can ground each evidence item to the entities
 *  it links. Quotes are posting/profile-derived: untrusted payload data. */
export interface TailoringEvidenceRow {
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
  profileSkillId: string | null;
  profileProjectId: string | null;
  profileExperienceId: string | null;
}

/** markVariantReviewed's three-way outcome (the markPlanReviewed mirror): the
 *  conditional update alone cannot tell a missing/foreign variant (404) from
 *  an already-reviewed one (409), and the service must. */
export type VariantReviewOutcome =
  | { kind: 'reviewed'; variant: ResumeVariantRow }
  | { kind: 'already_reviewed' }
  | { kind: 'not_found' };

/**
 * The single policy site for the post-hoc 'flagged' status (the M1-12
 * pattern): an ok run whose parsed spec cited a ref that was never sent, or
 * whose order was not an exact permutation of the sent refs, is flagged AT
 * INSERT TIME — the tailoring analog of ADR-0006 layer 4. Non-ok statuses pass
 * through untouched (there is no spec to validate).
 */
export function deriveResumeRunStatus(
  status: Exclude<ResumeVariantRunStatus, 'flagged'>,
  specInvalid: boolean,
): ResumeVariantRunStatus {
  return status === 'ok' && specInvalid ? 'flagged' : status;
}

export interface ResumeVariantsRepository {
  /** The report row by id — user-scoped anchor read for the resume module
   *  (review-status gate + 404); missing and foreign-owned are one outcome. */
  findReportById(userId: string, reportId: string): Promise<FitReportRow | undefined>;

  /** Evidence links of the report's sub-scores, for the tailoring payload
   *  (requirement-keyed; strength + both quotes + the three entity FK ids). */
  findTailoringEvidenceForReport(userId: string, reportId: string): Promise<TailoringEvidenceRow[]>;

  /**
   * ONE transaction for a whole tailoring outcome (the persistDraftingOutcome
   * precedent): every wire-call audit row always; the variant row + its
   * complete entry + citation set ONLY when `variant` is provided — the
   * caller's contract is that `variant` implies the final run is ok and
   * spec-valid. The final run's stored status passes through
   * deriveResumeRunStatus (specInvalid=true ⇒ 'flagged', no variant row). The
   * variant insert is ON CONFLICT DO NOTHING on fit_report_id: a lost
   * concurrent race commits the runs and reports `conflicted` instead of
   * aborting the transaction. APPEND-ONLY: nothing mutates.
   */
  persistTailoringOutcome(
    userId: string,
    fitReportId: string,
    runs: ResumeVariantRunInsert[],
    specInvalid: boolean,
    variant: ResumeVariantInsert | undefined,
  ): Promise<TailoringPersistOutcome>;

  /** The report's variant with its tailoring run and joined entries +
   *  citations, or undefined when no variant exists (report existence is
   *  findReportById's business). */
  findVariantForReport(
    userId: string,
    fitReportId: string,
  ): Promise<VariantWithEntries | undefined>;

  /** Latest tailoring run for the report by (created_at, id) — the GET's
   *  failure-display read, used ONLY when no variant exists (R2). */
  findLatestRunForReport(
    userId: string,
    fitReportId: string,
  ): Promise<ResumeVariantRunRow | undefined>;

  /**
   * The one-shot draft→reviewed transition (the markPlanReviewed mirror):
   * conditional UPDATE pinned to review_status='draft', capturing notes at
   * that moment; on zero rows a user-scoped re-read disambiguates
   * already_reviewed from not_found.
   */
  markVariantReviewed(
    userId: string,
    variantId: string,
    notes: string | null,
  ): Promise<VariantReviewOutcome>;

  /** The variant row by id, user-scoped — the review/export anchor read
   *  (missing and foreign-owned are one outcome). */
  findVariantById(userId: string, variantId: string): Promise<ResumeVariantRow | undefined>;
}

export function createResumeVariantsRepository(db: Db): ResumeVariantsRepository {
  /** Load the ordered entry + citation tree for a variant (shared by the
   *  report-scoped read). */
  async function loadEntries(variantId: string): Promise<VariantEntryWithCitations[]> {
    const entryRows = await db
      .select()
      .from(resumeVariantEntries)
      .where(eq(resumeVariantEntries.resumeVariantId, variantId))
      .orderBy(
        asc(resumeVariantEntries.section),
        asc(resumeVariantEntries.position),
        asc(resumeVariantEntries.id),
      );
    if (entryRows.length === 0) return [];

    const entryIds = entryRows.map((row) => row.id);
    const citationRows = await db
      .select({
        citation: resumeVariantCitations,
        gapClassification: gaps.classification,
        requirementId: gaps.requirementId,
        requirementText: requirements.text,
        requirementKind: requirements.kind,
        requirementCategory: requirements.category,
      })
      .from(resumeVariantCitations)
      .innerJoin(gaps, eq(gaps.id, resumeVariantCitations.gapId))
      .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
      .where(inArray(resumeVariantCitations.resumeVariantEntryId, entryIds))
      .orderBy(asc(resumeVariantCitations.position), asc(resumeVariantCitations.id));

    const byEntry = new Map<string, CitationWithGap[]>();
    for (const row of citationRows) {
      const list = byEntry.get(row.citation.resumeVariantEntryId) ?? [];
      list.push(row);
      byEntry.set(row.citation.resumeVariantEntryId, list);
    }
    return entryRows.map((entry) => ({ entry, citations: byEntry.get(entry.id) ?? [] }));
  }

  return {
    async findReportById(userId, reportId) {
      const [report] = await db
        .select()
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.id, reportId)))
        .limit(1);
      return report;
    },

    async findTailoringEvidenceForReport(userId, reportId) {
      return db
        .select({
          requirementId: evidenceLinks.requirementId,
          strength: evidenceLinks.strength,
          postingQuote: evidenceLinks.postingQuote,
          profileQuote: evidenceLinks.profileQuote,
          profileSkillId: evidenceLinks.profileSkillId,
          profileProjectId: evidenceLinks.profileProjectId,
          profileExperienceId: evidenceLinks.profileExperienceId,
        })
        .from(evidenceLinks)
        .innerJoin(fitSubScores, eq(fitSubScores.id, evidenceLinks.fitSubScoreId))
        .where(and(eq(evidenceLinks.userId, userId), eq(fitSubScores.fitReportId, reportId)))
        .orderBy(asc(evidenceLinks.createdAt), asc(evidenceLinks.id));
    },

    async persistTailoringOutcome(userId, fitReportId, runs, specInvalid, variant) {
      if (runs.length === 0) throw new Error('persistTailoringOutcome requires at least one run');
      const finalIndex = runs.length - 1;

      return db.transaction(async (tx) => {
        const runRows: ResumeVariantRunRow[] = [];
        for (const [index, run] of runs.entries()) {
          const [runRow] = await tx
            .insert(resumeVariantRuns)
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
                index === finalIndex ? deriveResumeRunStatus(run.status, specInvalid) : run.status,
              createdAt: run.createdAt,
            })
            .returning();
          if (!runRow) throw new Error('resume_variant_runs insert returned no rows');
          runRows.push(runRow);
        }

        const finalRun = runRows[finalIndex];
        if (!finalRun) throw new Error('unreachable: runs is non-empty');

        let variantCreated = false;
        let conflicted = false;
        if (variant !== undefined) {
          if (finalRun.status !== 'ok') {
            throw new Error('a resume variant requires an ok, spec-valid final run');
          }
          const [variantRow] = await tx
            .insert(resumeVariants)
            .values({
              userId,
              fitReportId,
              tailoringRunId: finalRun.id,
              renderedMarkdown: variant.renderedMarkdown,
            })
            .onConflictDoNothing({ target: resumeVariants.fitReportId })
            .returning();
          if (variantRow) {
            variantCreated = true;
            for (const entry of variant.entries) {
              const [entryRow] = await tx
                .insert(resumeVariantEntries)
                .values({
                  userId,
                  resumeVariantId: variantRow.id,
                  section: entry.section,
                  position: entry.position,
                  profileSkillId: entry.profileSkillId,
                  profileProjectId: entry.profileProjectId,
                  profileExperienceId: entry.profileExperienceId,
                  label: entry.label,
                  detail: entry.detail,
                  emphasis: entry.emphasis,
                  reason: entry.reason,
                })
                .returning();
              if (!entryRow) throw new Error('resume_variant_entries insert returned no rows');
              if (entry.citationGapIds.length > 0) {
                await tx.insert(resumeVariantCitations).values(
                  entry.citationGapIds.map((gapId, position) => ({
                    userId,
                    resumeVariantEntryId: entryRow.id,
                    gapId,
                    position,
                  })),
                );
              }
            }
          } else {
            conflicted = true;
          }
        }

        return { runs: runRows, variantCreated, conflicted };
      });
    },

    async findVariantForReport(userId, fitReportId) {
      const [variantRow] = await db
        .select()
        .from(resumeVariants)
        .where(and(eq(resumeVariants.userId, userId), eq(resumeVariants.fitReportId, fitReportId)))
        .limit(1);
      if (!variantRow) return undefined;

      const [runRow] = await db
        .select()
        .from(resumeVariantRuns)
        .where(eq(resumeVariantRuns.id, variantRow.tailoringRunId))
        .limit(1);
      if (!runRow) throw new Error('resume variant has no tailoring run (FK violated?)');

      const entries = await loadEntries(variantRow.id);
      return { variant: variantRow, run: runRow, entries };
    },

    async findLatestRunForReport(userId, fitReportId) {
      const [runRow] = await db
        .select()
        .from(resumeVariantRuns)
        .where(
          and(eq(resumeVariantRuns.userId, userId), eq(resumeVariantRuns.fitReportId, fitReportId)),
        )
        .orderBy(desc(resumeVariantRuns.createdAt), desc(resumeVariantRuns.id))
        .limit(1);
      return runRow;
    },

    async markVariantReviewed(userId, variantId, notes) {
      const [updated] = await db
        .update(resumeVariants)
        .set({ reviewStatus: 'reviewed', notes })
        .where(
          and(
            eq(resumeVariants.userId, userId),
            eq(resumeVariants.id, variantId),
            eq(resumeVariants.reviewStatus, 'draft'),
          ),
        )
        .returning();
      if (updated) return { kind: 'reviewed', variant: updated };

      const [existing] = await db
        .select({ id: resumeVariants.id })
        .from(resumeVariants)
        .where(and(eq(resumeVariants.userId, userId), eq(resumeVariants.id, variantId)))
        .limit(1);
      return existing ? { kind: 'already_reviewed' } : { kind: 'not_found' };
    },

    async findVariantById(userId, variantId) {
      const [variantRow] = await db
        .select()
        .from(resumeVariants)
        .where(and(eq(resumeVariants.userId, userId), eq(resumeVariants.id, variantId)))
        .limit(1);
      return variantRow;
    },
  };
}
