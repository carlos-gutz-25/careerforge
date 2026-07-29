import { describe, expect, it } from 'vitest';

import {
  aggregateMarketSignal,
  MARKET_SIGNAL_SCORER_VERSION,
  type MarketSignalInstance,
} from './market-signal.ts';

// M12-02 (requirement-assessment taxonomy): the new evidence-status classes and the
// 'needs_input' noAction reason. An all-unknown group is "we don't know", NOT
// "covered": it lands in noAction with reason 'needs_input'. needsInputCount is the
// visible per-group unknown signal, surfaced on bucketed groups too. Groups here
// share a requirementText (the recurrence key) and differ by postingId/gapId. All
// fixtures fictional (RISKS P-01): no real employer/person/posting.

let idSeq = 0;
function inst(over: Partial<MarketSignalInstance> = {}): MarketSignalInstance {
  idSeq += 1;
  return {
    postingId: 'p1',
    fitReportId: 'r1',
    reportVerdict: 'scored',
    reportReviewStatus: 'reviewed',
    gapId: `g${String(idSeq)}`,
    requirementId: `req${String(idSeq)}`,
    requirementText: 'Gizmo Framework',
    kind: 'must_have',
    category: 'framework',
    classification: 'genuine_gap',
    userOverridden: false,
    evidenceStrengths: [],
    ...over,
  };
}

/** First element, asserted present (satisfies noUncheckedIndexedAccess). */
function firstOf<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('expected at least one item');
  return item;
}

describe('aggregateMarketSignal - needs_input taxonomy (M12-02)', () => {
  it('MARKET_SIGNAL_SCORER_VERSION is 2', () => {
    expect(MARKET_SIGNAL_SCORER_VERSION).toBe(2);
  });

  it('an all-unknown group is noAction/needs_input, never covered, never bucketed', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', requirementText: 'Widget Runtime', classification: 'unknown' }),
      inst({ postingId: 'p2', requirementText: 'Widget Runtime', classification: 'unknown' }),
      inst({ postingId: 'p3', requirementText: 'Widget Runtime', classification: 'unknown' }),
    ]);
    // Not in any actionable bucket.
    expect(result.buckets.build).toHaveLength(0);
    expect(result.buckets.sharpen).toHaveLength(0);
    expect(result.buckets.prove).toHaveLength(0);
    expect(result.buckets.certify).toHaveLength(0);
    // In noAction with the needs_input reason - NOT covered_or_low_priority.
    expect(result.noAction).toHaveLength(1);
    const group = firstOf(result.noAction);
    expect(group.reason).toBe('needs_input');
    expect(group.reason).not.toBe('covered_or_low_priority');
    // needsInputCount equals the number of unknown instances.
    expect(group.needsInputCount).toBe(3);
    expect(group.classificationCounts.unknown).toBe(3);
  });

  it('an all satisfied_fact / not_applicable group is covered_or_low_priority with needsInputCount 0', () => {
    const result = aggregateMarketSignal([
      inst({
        postingId: 'p1',
        requirementText: 'Legacy Bolt Standard',
        classification: 'satisfied_fact',
      }),
      inst({
        postingId: 'p2',
        requirementText: 'Legacy Bolt Standard',
        classification: 'not_applicable',
      }),
    ]);
    // Nothing actionable and no unknown -> genuinely covered/low-priority, not needs_input.
    expect(result.buckets.build).toHaveLength(0);
    expect(result.noAction).toHaveLength(1);
    const group = firstOf(result.noAction);
    expect(group.reason).toBe('covered_or_low_priority');
    expect(group.reason).not.toBe('needs_input');
    expect(group.needsInputCount).toBe(0);
  });

  it('a mixed genuine_gap + unknown group buckets by the actionable class and still surfaces needsInputCount', () => {
    const result = aggregateMarketSignal([
      inst({
        postingId: 'p1',
        requirementText: 'Sprocket Pipeline',
        classification: 'genuine_gap',
      }),
      inst({
        postingId: 'p2',
        requirementText: 'Sprocket Pipeline',
        classification: 'genuine_gap',
      }),
      inst({ postingId: 'p3', requirementText: 'Sprocket Pipeline', classification: 'unknown' }),
    ]);
    // Actionable class wins the routing -> build; the unknown does not divert it to noAction.
    expect(result.noAction).toHaveLength(0);
    expect(result.buckets.build).toHaveLength(1);
    const group = firstOf(result.buckets.build);
    // needsInputCount is surfaced on the bucketed group = the unknown count.
    expect(group.needsInputCount).toBe(1);
    expect(group.classificationCounts.unknown).toBe(1);
    expect(group.classificationCounts.genuine_gap).toBe(2);
  });

  it('needsInputCount is 0 on a group with zero unknown instances', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', requirementText: 'Cog Assembly', classification: 'genuine_gap' }),
      inst({ postingId: 'p2', requirementText: 'Cog Assembly', classification: 'needs_refresh' }),
    ]);
    const group = firstOf(result.buckets.build);
    expect(group.needsInputCount).toBe(0);
    expect(group.classificationCounts.unknown).toBe(0);
  });
});
