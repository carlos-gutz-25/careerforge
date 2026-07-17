import { verifyQuotes } from '@careerforge/core';
import { type ExtractionsRepository } from '@careerforge/db';

// The M1-06 backfill: verify every quote_verified IS NULL requirement (all
// requirement-bearing runs, all users — pre-M1-06 rows; new inserts are
// verified inline so the population only shrinks). Deterministic, idempotent,
// zero LLM involvement. OUTPUT LAW: counts, ids, and statuses only — quote
// and posting text NEVER reach any output surface (the CLI runs against the
// real database).

export interface BackfillTotals {
  runsProcessed: number;
  requirementsVerified: number;
  unverifiedRequirements: number;
  runsFlagged: number;
}

export async function runQuoteBackfill(
  extractions: ExtractionsRepository,
  write: (line: string) => void,
): Promise<BackfillTotals> {
  const batches = await extractions.findRunsWithUnverifiedQuotes();
  const totals: BackfillTotals = {
    runsProcessed: 0,
    requirementsVerified: 0,
    unverifiedRequirements: 0,
    runsFlagged: 0,
  };

  for (const batch of batches) {
    // Only the NULL rows get fresh verdicts; already-set rows keep their
    // stored value (applyQuoteVerification recomputes the run status over
    // the FULL set either way).
    const pending = batch.requirements.filter((requirement) => requirement.quoteVerified === null);
    const verdicts = verifyQuotes(
      batch.postingRawText,
      pending.map((requirement) => requirement.sourceQuote),
    );
    const applied = pending.map((requirement, index) => ({
      requirementId: requirement.id,
      quoteVerified: verdicts[index] ?? false,
    }));

    // Per-run transaction: a mid-backfill failure leaves finished runs done
    // and the rest NULL — a rerun picks them up (idempotent recompute).
    const result = await extractions.applyQuoteVerification(batch.userId, batch.runId, applied);

    const failed = applied.filter((verdict) => !verdict.quoteVerified);
    totals.runsProcessed += 1;
    totals.requirementsVerified += result.requirementsUpdated;
    totals.unverifiedRequirements += failed.length;
    if (result.runStatus === 'flagged') totals.runsFlagged += 1;

    write(
      `run ${batch.runId} posting ${batch.postingId}: checked ${String(applied.length)}, ` +
        `verified ${String(applied.length - failed.length)}, unverified ${String(failed.length)}, ` +
        `status ${batch.status} -> ${result.runStatus}`,
    );
    // Row ids ONLY for false verdicts (never quote text): the operator
    // inspects each flagged row themselves, in their own SQL session.
    for (const verdict of failed) {
      write(`  unverified requirement ${verdict.requirementId}`);
    }
  }

  return totals;
}
