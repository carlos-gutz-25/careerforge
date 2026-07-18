import {
  REQUIREMENT_BEARING_STATUSES,
  type ExtractionRunStatus,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { extractionRuns, requirements } from '../schema/extractions.ts';
import { jobPostings } from '../schema/jobs.ts';

export type ExtractionRunRow = typeof extractionRuns.$inferSelect;
export type RequirementRow = typeof requirements.$inferSelect;

/** One wire call's audit row. The SERVICE maps packages/llm's LlmCallRecord
 *  into this shape (flattened usage, timestamp → createdAt) — this package's
 *  only internal dependency stays @careerforge/core. */
export interface ExtractionRunInsert {
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
   *  persistExtraction derives it internally (M1-06 evidence verification)
   *  when any requirement's quoteVerified is false. */
  status: Exclude<ExtractionRunStatus, 'flagged'>;
  /** LlmCallRecord.timestamp (the runner's now-seam clock, F3). */
  createdAt: Date;
}

export interface RequirementInsert {
  kind: RequirementKind;
  category: RequirementCategory;
  text: string;
  sourceQuote: string;
  confidence: number;
  /** Evidence verification verdict (M1-06), computed by the service BEFORE
   *  persist — every new requirement lands verified. NULL exists only on
   *  pre-M1-06 rows until the backfill CLI covers them.
   *  position is assigned from array order by persistExtraction. */
  quoteVerified: boolean;
}

export interface ExtractionOutcome {
  runs: ExtractionRunRow[];
  requirements: RequirementRow[];
  /** true iff this persist flipped the posting new → extracted. */
  postingFlipped: boolean;
}

export interface RunWithRequirements {
  run: ExtractionRunRow;
  requirements: RequirementRow[];
}

/** A run needing backfill verification (CLI-only surface — see
 *  findRunsWithUnverifiedQuotes). */
export interface UnverifiedRunBatch {
  runId: string;
  userId: string;
  postingId: string;
  /** Status before backfill — the CLI's before→after output line. */
  status: ExtractionRunStatus;
  /** The posting's verbatim text — verification source. Never leaves the
   *  backfill process; counts/ids only on any output surface. */
  postingRawText: string;
  /** ALL of the run's requirements (not just the NULL ones), position order —
   *  the status recompute must see the full set. */
  requirements: { id: string; sourceQuote: string; quoteVerified: boolean | null }[];
}

export interface QuoteVerdict {
  requirementId: string;
  quoteVerified: boolean;
}

/**
 * THE status-derivation policy (M1-06, single site — used by
 * persistExtraction at insert time and applyQuoteVerification at backfill):
 * a run is 'flagged' iff ANY of its requirements failed verification, else
 * 'ok'. Deterministic and idempotent over stored data.
 */
export function deriveRunStatus(quoteVerdicts: readonly (boolean | null)[]): 'ok' | 'flagged' {
  return quoteVerdicts.some((verdict) => verdict === false) ? 'flagged' : 'ok';
}

function isRequirementBearing(status: ExtractionRunStatus): boolean {
  return (REQUIREMENT_BEARING_STATUSES as readonly ExtractionRunStatus[]).includes(status);
}

export interface ExtractionsRepository {
  /**
   * ONE transaction for a whole extraction attempt (M1-05 decision F4):
   * every collected call record (a retry means two), then — iff the FINAL
   * run is requirement-bearing and requirements were supplied — the
   * requirement rows FK'd to that final run (position = array order), then
   * the conditional posting flip new → extracted (WHERE status = 'new':
   * extracted/scored/archived are never touched, and a concurrent archive
   * makes the flip a no-op while the audit rows still land). All-or-nothing:
   * a requirement-bearing run row implies its VERIFIED requirements are
   * committed with it — the invariant the cache read and the GET path rely
   * on. The error path persists records too (requirements undefined).
   *
   * M1-06 derivation, AT INSERT TIME (the gates below read the final
   * status, so the order is load-bearing): when the final record's runner
   * status is 'ok' and requirements are supplied, the run row is WRITTEN
   * with deriveRunStatus of the verdicts — 'flagged' iff any quoteVerified
   * is false. Retry records keep their runner statuses untouched. The
   * posting flip fires for BOTH requirement-bearing statuses: a flagged run
   * bears requirements, so the posting IS extracted (flagged means review,
   * not absence — leaving it 'new' would contradict the unarchive law).
   */
  persistExtraction(
    userId: string,
    postingId: string,
    runs: ExtractionRunInsert[],
    requirementInserts: RequirementInsert[] | undefined,
  ): Promise<ExtractionOutcome>;

  /**
   * Latest requirement-bearing run (ok OR flagged; createdAt desc, id
   * tiebreak) + its requirements in position order. With promptId: the
   * cache read for POST /extract (posting content is immutable after
   * ingest, so posting_id × prompt_id ≡ content_hash × prompt_id within a
   * user; a flagged run stays cache-served — flags mean human review, and
   * `force` is the explicit paid re-run). Without: the GET path (latest
   * requirement-bearing run of any prompt version — the UI must SEE flagged
   * runs to render them prominently). undefined when the posting has no
   * requirement-bearing run — or isn't this user's (user-scoped like every
   * read here).
   */
  findLatestRequirementBearingRun(
    userId: string,
    postingId: string,
    promptId?: string,
  ): Promise<RunWithRequirements | undefined>;

  /** Any requirement-bearing run for the posting — the artifact-derived
   *  unarchive law (M1-02 park, resolved at M1-05; widened to include
   *  flagged at M1-06: artifacts exist, restore is 'extracted'). */
  hasRequirementBearingRun(userId: string, postingId: string): Promise<boolean>;

  /** ONE run's requirements in position order, user-scoped like every wire
   *  read (unlike the backfill exception below). M1-10: the GET fit path
   *  re-derives unscoredRequirements from the SCORED run's rows — which may
   *  no longer be the latest run after a re-extraction. Empty when the run
   *  has no requirements, or isn't this user's. */
  findRequirementsForRun(userId: string, runId: string): Promise<RequirementRow[]>;

  /**
   * Backfill read (M1-06 CLI): requirement-bearing runs still holding ≥1
   * quote_verified IS NULL requirement, each with its posting's rawText and
   * its FULL requirement set. DELIBERATE EXCEPTION: this is the repository's
   * only UNSCOPED read — the backfill is a cross-user maintenance pass by
   * construction. Not license for unscoped reads elsewhere: the surface is
   * CLI-only, rawText never leaves the backfill process, and the writes
   * (applyQuoteVerification) remain user-scoped per run.
   */
  findRunsWithUnverifiedQuotes(): Promise<UnverifiedRunBatch[]>;

  /**
   * Backfill write (M1-06): ONE transaction — per-requirement quote_verified
   * updates (each scoped by id + userId + extractionRunId), then the run's
   * status recomputed over its FULL requirement set via deriveRunStatus.
   * Only requirement-bearing runs are recomputed (never the runner's failure
   * statuses). Idempotent: re-applying identical verdicts is a no-op.
   */
  applyQuoteVerification(
    userId: string,
    runId: string,
    verdicts: QuoteVerdict[],
  ): Promise<{ requirementsUpdated: number; runStatus: ExtractionRunStatus }>;
}

export function createExtractionsRepository(db: Db): ExtractionsRepository {
  return {
    async persistExtraction(userId, postingId, runs, requirementInserts) {
      if (runs.length === 0) throw new Error('persistExtraction requires at least one run');
      // Derive the FINAL run's status before insert (M1-06): 'ok' with any
      // failed verdict becomes 'flagged'. Runner failure statuses and retry
      // records are never touched.
      const finalInsert = runs[runs.length - 1];
      if (!finalInsert) throw new Error('unreachable: runs is non-empty');
      const finalStatus: ExtractionRunStatus =
        finalInsert.status === 'ok' && requirementInserts && requirementInserts.length > 0
          ? deriveRunStatus(requirementInserts.map((requirement) => requirement.quoteVerified))
          : finalInsert.status;
      const runValues = runs.map((run, index) => ({
        userId,
        postingId,
        ...run,
        status: index === runs.length - 1 ? finalStatus : run.status,
      }));

      return db.transaction(async (tx) => {
        const insertedRuns = await tx.insert(extractionRuns).values(runValues).returning();
        // Multi-row INSERT … RETURNING preserves VALUES order; the last
        // inserted row is the final attempt.
        const finalRun = insertedRuns[insertedRuns.length - 1];
        if (!finalRun) throw new Error('extraction_runs insert returned no rows');

        let insertedRequirements: RequirementRow[] = [];
        let postingFlipped = false;
        const requirementBearing = isRequirementBearing(finalRun.status);
        if (requirementBearing && requirementInserts && requirementInserts.length > 0) {
          insertedRequirements = await tx
            .insert(requirements)
            .values(
              requirementInserts.map((requirement, index) => ({
                userId,
                extractionRunId: finalRun.id,
                position: index,
                ...requirement,
              })),
            )
            .returning();
        }
        if (requirementBearing) {
          const [flipped] = await tx
            .update(jobPostings)
            .set({ status: 'extracted' })
            .where(
              and(
                eq(jobPostings.userId, userId),
                eq(jobPostings.id, postingId),
                eq(jobPostings.status, 'new'),
              ),
            )
            .returning();
          postingFlipped = flipped !== undefined;
        }
        return { runs: insertedRuns, requirements: insertedRequirements, postingFlipped };
      });
    },

    async findLatestRequirementBearingRun(userId, postingId, promptId) {
      const conditions = [
        eq(extractionRuns.userId, userId),
        eq(extractionRuns.postingId, postingId),
        inArray(extractionRuns.status, [...REQUIREMENT_BEARING_STATUSES]),
      ];
      if (promptId !== undefined) conditions.push(eq(extractionRuns.promptId, promptId));
      const [run] = await db
        .select()
        .from(extractionRuns)
        .where(and(...conditions))
        .orderBy(desc(extractionRuns.createdAt), desc(extractionRuns.id))
        .limit(1);
      if (!run) return undefined;

      const requirementRows = await db
        .select()
        .from(requirements)
        .where(eq(requirements.extractionRunId, run.id))
        .orderBy(asc(requirements.position));
      return { run, requirements: requirementRows };
    },

    async findRequirementsForRun(userId, runId) {
      return db
        .select()
        .from(requirements)
        .where(and(eq(requirements.userId, userId), eq(requirements.extractionRunId, runId)))
        .orderBy(asc(requirements.position));
    },

    async hasRequirementBearingRun(userId, postingId) {
      const [row] = await db
        .select({ id: extractionRuns.id })
        .from(extractionRuns)
        .where(
          and(
            eq(extractionRuns.userId, userId),
            eq(extractionRuns.postingId, postingId),
            inArray(extractionRuns.status, [...REQUIREMENT_BEARING_STATUSES]),
          ),
        )
        .limit(1);
      return row !== undefined;
    },

    async findRunsWithUnverifiedQuotes() {
      const candidateRuns = await db
        .select({
          runId: extractionRuns.id,
          userId: extractionRuns.userId,
          postingId: extractionRuns.postingId,
          status: extractionRuns.status,
          postingRawText: jobPostings.rawText,
        })
        .from(extractionRuns)
        .innerJoin(jobPostings, eq(extractionRuns.postingId, jobPostings.id))
        .where(
          and(
            inArray(extractionRuns.status, [...REQUIREMENT_BEARING_STATUSES]),
            inArray(
              extractionRuns.id,
              db
                .select({ id: requirements.extractionRunId })
                .from(requirements)
                .where(isNull(requirements.quoteVerified)),
            ),
          ),
        )
        .orderBy(asc(extractionRuns.createdAt), asc(extractionRuns.id));
      if (candidateRuns.length === 0) return [];

      const requirementRows = await db
        .select({
          id: requirements.id,
          extractionRunId: requirements.extractionRunId,
          sourceQuote: requirements.sourceQuote,
          quoteVerified: requirements.quoteVerified,
        })
        .from(requirements)
        .where(
          inArray(
            requirements.extractionRunId,
            candidateRuns.map((run) => run.runId),
          ),
        )
        .orderBy(asc(requirements.position));

      return candidateRuns.map((run) => ({
        ...run,
        requirements: requirementRows
          .filter((row) => row.extractionRunId === run.runId)
          .map(({ id, sourceQuote, quoteVerified }) => ({ id, sourceQuote, quoteVerified })),
      }));
    },

    async applyQuoteVerification(userId, runId, verdicts) {
      return db.transaction(async (tx) => {
        let requirementsUpdated = 0;
        for (const { requirementId, quoteVerified } of verdicts) {
          const updated = await tx
            .update(requirements)
            .set({ quoteVerified })
            .where(
              and(
                eq(requirements.id, requirementId),
                eq(requirements.userId, userId),
                eq(requirements.extractionRunId, runId),
              ),
            )
            .returning({ id: requirements.id });
          requirementsUpdated += updated.length;
        }

        // Recompute the run status over the FULL post-update requirement set
        // (the single policy site — deriveRunStatus).
        const fullSet = await tx
          .select({ quoteVerified: requirements.quoteVerified })
          .from(requirements)
          .where(and(eq(requirements.extractionRunId, runId), eq(requirements.userId, userId)));
        const nextStatus = deriveRunStatus(fullSet.map((row) => row.quoteVerified));
        const [updatedRun] = await tx
          .update(extractionRuns)
          .set({ status: nextStatus })
          .where(
            and(
              eq(extractionRuns.id, runId),
              eq(extractionRuns.userId, userId),
              inArray(extractionRuns.status, [...REQUIREMENT_BEARING_STATUSES]),
            ),
          )
          .returning({ status: extractionRuns.status });
        if (!updatedRun) {
          throw new Error(
            'applyQuoteVerification: run not found, foreign, or not requirement-bearing',
          );
        }
        return { requirementsUpdated, runStatus: updatedRun.status };
      });
    },
  };
}
