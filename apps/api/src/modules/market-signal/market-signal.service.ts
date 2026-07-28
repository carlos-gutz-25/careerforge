import { type MarketSignalReport } from '@careerforge/core';
import { type GapsRepository } from '@careerforge/db';
import { aggregateMarketSignal, MARKET_SIGNAL_HONESTY } from '@careerforge/scoring';

// M9-02 (V2-PLAN 3.5): the market-signal service. Deterministic, read-only, NO LLM
// and NO persistence - it recomputes the aggregate on every request (scorerVersion
// in the response is the reproducibility anchor). Never-trust-the-client (D7): the
// ONLY input is the authenticated userId; both repository reads are server-side and
// user-scoped. The scorer is pure (packages/scoring, never imports packages/llm);
// the honesty string is the scorer's own const, composed onto the wire here.
// postingsWithSignal is derived from the actually-aggregated rows (the honest
// "postings that contributed"), completing the D5 cohort disclosure.

export interface MarketSignalService {
  /** The whole-cohort market-signal report for a user (empty cohort = valid empty
   *  report, never an error - the cohort object says exactly how thin the data is). */
  reportForUser(userId: string): Promise<MarketSignalReport>;
}

export function createMarketSignalService(deps: { gaps: GapsRepository }): MarketSignalService {
  const { gaps } = deps;
  return {
    async reportForUser(userId) {
      const [rows, cohortCounts] = await Promise.all([
        gaps.listMarketSignalRows(userId),
        gaps.countMarketSignalCohort(userId),
      ]);
      const result = aggregateMarketSignal(rows);
      const postingsWithSignal = new Set(rows.map((row) => row.postingId)).size;
      return {
        ...result,
        honesty: MARKET_SIGNAL_HONESTY,
        cohort: { ...cohortCounts, postingsWithSignal },
      };
    },
  };
}
