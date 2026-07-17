import type { ExtractionRunStatus, RequirementCategory, RequirementKind } from '@careerforge/core';
import { and, asc, desc, eq } from 'drizzle-orm';

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
  /** The runner's five states — 'flagged' is M1-06's, never inserted here. */
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
  // quoteVerified stays NULL until evidence verification (M1-06);
  // position is assigned from array order by persistExtraction.
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

export interface ExtractionsRepository {
  /**
   * ONE transaction for a whole extraction attempt (M1-05 decision F4):
   * every collected call record (a retry means two), then — iff the FINAL
   * run is 'ok' and requirements were supplied — the requirement rows FK'd
   * to that final run (position = array order), then the conditional posting
   * flip new → extracted (WHERE status = 'new': extracted/scored/archived
   * are never touched, and a concurrent archive makes the flip a no-op while
   * the audit rows still land). All-or-nothing: an ok run row implies its
   * requirements are committed with it — the invariant the cache read and
   * M1-06 rely on. The error path persists records too (requirements
   * undefined).
   */
  persistExtraction(
    userId: string,
    postingId: string,
    runs: ExtractionRunInsert[],
    requirementInserts: RequirementInsert[] | undefined,
  ): Promise<ExtractionOutcome>;

  /**
   * Latest ok run (createdAt desc, id tiebreak) + its requirements in
   * position order. With promptId: the cache read for POST /extract
   * (posting content is immutable after ingest, so posting_id × prompt_id
   * ≡ content_hash × prompt_id within a user). Without: the GET path
   * (latest ok run of any prompt version). undefined when the posting has
   * no ok run — or isn't this user's (user-scoped like every read here).
   */
  findLatestOkRun(
    userId: string,
    postingId: string,
    promptId?: string,
  ): Promise<RunWithRequirements | undefined>;

  /** Any ok run for the posting — the artifact-derived unarchive law
   *  (M1-02 park, resolved at M1-05). */
  hasOkRun(userId: string, postingId: string): Promise<boolean>;
}

export function createExtractionsRepository(db: Db): ExtractionsRepository {
  return {
    async persistExtraction(userId, postingId, runs, requirementInserts) {
      if (runs.length === 0) throw new Error('persistExtraction requires at least one run');
      return db.transaction(async (tx) => {
        const insertedRuns = await tx
          .insert(extractionRuns)
          .values(runs.map((run) => ({ userId, postingId, ...run })))
          .returning();
        // Multi-row INSERT … RETURNING preserves VALUES order; the last
        // inserted row is the final attempt.
        const finalRun = insertedRuns[insertedRuns.length - 1];
        if (!finalRun) throw new Error('extraction_runs insert returned no rows');

        let insertedRequirements: RequirementRow[] = [];
        let postingFlipped = false;
        if (finalRun.status === 'ok' && requirementInserts && requirementInserts.length > 0) {
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
        if (finalRun.status === 'ok') {
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

    async findLatestOkRun(userId, postingId, promptId) {
      const conditions = [
        eq(extractionRuns.userId, userId),
        eq(extractionRuns.postingId, postingId),
        eq(extractionRuns.status, 'ok'),
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

    async hasOkRun(userId, postingId) {
      const [row] = await db
        .select({ id: extractionRuns.id })
        .from(extractionRuns)
        .where(
          and(
            eq(extractionRuns.userId, userId),
            eq(extractionRuns.postingId, postingId),
            eq(extractionRuns.status, 'ok'),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
  };
}
