import { describe, expect, it } from 'vitest';

import {
  aggregateMarketSignal,
  BUCKET_SEVERITY,
  CERTIFICATION_TERMS,
  CERTIFY_MIN_POSTINGS,
  MARKET_SIGNAL_HONESTY,
  MARKET_SIGNAL_SCORER_VERSION,
  type MarketSignalInstance,
} from './market-signal.ts';

// M9-02: the pure market-signal aggregator's contract. Every figure a count or the
// engine's evidence-weight currency; the ladder is first-match and fully decidable
// from emitted fields. The D8 fixture rows below are the permanent detection table;
// two neuter demonstrations (bucket ladder, certification probe) ride the PR.

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
    requirementText: 'React',
    kind: 'must_have',
    category: 'framework',
    classification: 'genuine_gap',
    userOverridden: false,
    evidenceStrengths: [],
    ...over,
  };
}

/** Deterministic shuffle (index-parametrized, no Math.random - scoring stays pure
 *  even in tests). Reverses then rotates so order genuinely differs. */
function shuffled<T>(items: T[]): T[] {
  const [head, ...tail] = [...items].reverse();
  return head === undefined ? [] : [...tail, head];
}

/** First element, asserted present (satisfies noUncheckedIndexedAccess). */
function firstOf<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('expected at least one item');
  return item;
}

describe('aggregateMarketSignal', () => {
  it('empty input yields empty buckets and zero counts, versioned', () => {
    const result = aggregateMarketSignal([]);
    expect(result).toEqual({
      scorerVersion: MARKET_SIGNAL_SCORER_VERSION,
      buckets: { sharpen: [], prove: [], build: [], certify: [] },
      noAction: [],
      groupCount: 0,
      instanceCount: 0,
    });
  });

  it('groups multi-posting recurrence by exact normalized text', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', fitReportId: 'r1', requirementText: 'React' }),
      inst({ postingId: 'p2', fitReportId: 'r2', requirementText: 'React' }),
    ]);
    expect(result.groupCount).toBe(1);
    expect(result.instanceCount).toBe(2);
    const group = firstOf(result.buckets.build);
    expect(group.key).toBe('React');
    expect(group.postingCount).toBe(2);
    expect(group.instanceCount).toBe(2);
  });

  it('paraphrases under-group: different text is a separate group (R1)', () => {
    const result = aggregateMarketSignal([
      inst({ requirementText: 'React' }),
      inst({ requirementText: 'React.js' }),
    ]);
    expect(result.groupCount).toBe(2);
  });

  it('collapses whitespace-only differences into one group (exact-text key)', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p2', requirementText: 'React  Native' }),
      inst({ postingId: 'p1', requirementText: 'React Native' }),
    ]);
    expect(result.groupCount).toBe(1);
    const group = firstOf(result.buckets.build);
    // displayText is the first instance in deterministic (postingId, ...) order = p1.
    expect(group.displayText).toBe('React Native');
    expect(group.key).toBe('React Native');
  });

  it('same-report duplicate text: instanceCount exceeds postingCount', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', fitReportId: 'r1', requirementId: 'reqA', gapId: 'gA' }),
      inst({ postingId: 'p1', fitReportId: 'r1', requirementId: 'reqB', gapId: 'gB' }),
    ]);
    const group = firstOf(result.buckets.build);
    expect(group.instanceCount).toBe(2);
    expect(group.postingCount).toBe(1);
  });

  it('splits must-have vs preferred postings', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', kind: 'must_have' }),
      inst({ postingId: 'p2', kind: 'nice_to_have' }),
    ]);
    const group = firstOf(result.buckets.build);
    expect(group.mustHavePostingCount).toBe(1);
    expect(group.niceToHavePostingCount).toBe(1);
  });

  it('counts excluded-verdict postings but keeps mixed groups in a bucket', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', reportVerdict: 'scored' }),
      inst({ postingId: 'p2', reportVerdict: 'excluded' }),
    ]);
    const group = firstOf(result.buckets.build);
    expect(group.excludedPostingCount).toBe(1);
    expect(group.postingCount).toBe(2);
    expect(result.noAction).toHaveLength(0);
  });

  it('all-excluded group is noAction with the all_postings_excluded reason', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', reportVerdict: 'excluded' }),
      inst({ postingId: 'p2', reportVerdict: 'excluded' }),
    ]);
    expect(result.buckets.build).toHaveLength(0);
    expect(result.noAction).toHaveLength(1);
    expect(firstOf(result.noAction).reason).toBe('all_postings_excluded');
  });

  it('all-covered group is noAction with the covered_or_low_priority reason', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', classification: 'have' }),
      inst({ postingId: 'p2', classification: 'low_priority' }),
    ]);
    expect(result.noAction).toHaveLength(1);
    expect(firstOf(result.noAction).reason).toBe('covered_or_low_priority');
  });

  it('covered_or_low_priority wins over all_postings_excluded (first-match order)', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', reportVerdict: 'excluded', classification: 'have' }),
      inst({ postingId: 'p2', reportVerdict: 'excluded', classification: 'low_priority' }),
    ]);
    expect(firstOf(result.noAction).reason).toBe('covered_or_low_priority');
  });

  describe('bucket ladder - modal actionable classification', () => {
    it('genuine_gap modal maps to build', () => {
      const result = aggregateMarketSignal([
        inst({ postingId: 'p1', classification: 'genuine_gap' }),
        inst({ postingId: 'p2', classification: 'genuine_gap' }),
        inst({ postingId: 'p3', classification: 'needs_refresh' }),
      ]);
      expect(result.buckets.build).toHaveLength(1);
      expect(result.buckets.sharpen).toHaveLength(0);
    });

    it('needs_refresh modal maps to sharpen', () => {
      const result = aggregateMarketSignal([
        inst({ postingId: 'p1', classification: 'needs_refresh' }),
        inst({ postingId: 'p2', classification: 'needs_refresh' }),
        inst({ postingId: 'p3', classification: 'genuine_gap' }),
      ]);
      expect(result.buckets.sharpen).toHaveLength(1);
    });

    it('have_undemonstrated modal maps to prove', () => {
      const result = aggregateMarketSignal([
        inst({ postingId: 'p1', classification: 'have_undemonstrated' }),
        inst({ postingId: 'p2', classification: 'have_undemonstrated' }),
        inst({ postingId: 'p3', classification: 'needs_refresh' }),
      ]);
      expect(result.buckets.prove).toHaveLength(1);
    });

    it('modal tie breaks by BUCKET_SEVERITY: genuine_gap beats needs_refresh beats have_undemonstrated', () => {
      // 1 each -> tie -> severity order picks genuine_gap -> build.
      const buildTie = aggregateMarketSignal([
        inst({ postingId: 'p1', classification: 'genuine_gap' }),
        inst({ postingId: 'p2', classification: 'needs_refresh' }),
        inst({ postingId: 'p3', classification: 'have_undemonstrated' }),
      ]);
      expect(buildTie.buckets.build).toHaveLength(1);

      // Drop genuine_gap: needs_refresh beats have_undemonstrated -> sharpen.
      const sharpenTie = aggregateMarketSignal([
        inst({ postingId: 'p1', classification: 'needs_refresh' }),
        inst({ postingId: 'p2', classification: 'have_undemonstrated' }),
      ]);
      expect(sharpenTie.buckets.sharpen).toHaveLength(1);
    });

    it('non-actionable instances do not vote in the modal (have/low_priority ignored)', () => {
      const result = aggregateMarketSignal([
        inst({ postingId: 'p1', classification: 'needs_refresh' }),
        inst({ postingId: 'p2', classification: 'have' }),
        inst({ postingId: 'p3', classification: 'have' }),
        inst({ postingId: 'p4', classification: 'low_priority' }),
      ]);
      // one actionable (needs_refresh) -> sharpen, despite covered instances.
      expect(result.buckets.sharpen).toHaveLength(1);
    });
  });

  describe('certification probe', () => {
    it('Certify at exactly CERTIFY_MIN_POSTINGS non-excluded mentioning postings (boundary)', () => {
      const result = aggregateMarketSignal([
        inst({
          postingId: 'p1',
          requirementText: 'AWS Certification',
          classification: 'genuine_gap',
        }),
        inst({
          postingId: 'p2',
          requirementText: 'AWS Certification',
          classification: 'genuine_gap',
        }),
      ]);
      expect(result.buckets.certify).toHaveLength(1);
      const group = firstOf(result.buckets.certify);
      expect(group.certification.mentioned).toBe(true);
      expect(group.certification.postingCount).toBe(CERTIFY_MIN_POSTINGS);
      expect(group.certification.matchedTerms).toEqual(['certification']);
      expect(result.buckets.build).toHaveLength(0);
    });

    it('one mentioning posting falls through to the modal bucket', () => {
      const result = aggregateMarketSignal([
        inst({
          postingId: 'p1',
          requirementText: 'AWS Certification',
          classification: 'genuine_gap',
        }),
      ]);
      expect(result.buckets.certify).toHaveLength(0);
      expect(result.buckets.build).toHaveLength(1);
      expect(firstOf(result.buckets.build).certification.mentioned).toBe(true);
      expect(firstOf(result.buckets.build).certification.postingCount).toBe(1);
    });

    it('excluded mentioning postings are not counted toward Certify', () => {
      const result = aggregateMarketSignal([
        inst({
          postingId: 'p1',
          requirementText: 'AWS Certification',
          reportVerdict: 'scored',
          classification: 'genuine_gap',
        }),
        inst({
          postingId: 'p2',
          requirementText: 'AWS Certification',
          reportVerdict: 'excluded',
          classification: 'genuine_gap',
        }),
      ]);
      // mentioned on both, but only p1 is non-excluded -> cert postingCount 1 < 2 -> build.
      expect(result.buckets.certify).toHaveLength(0);
      expect(result.buckets.build).toHaveLength(1);
      expect(firstOf(result.buckets.build).certification.postingCount).toBe(1);
    });

    it('concert / certainly are token-level negatives (never substring matches)', () => {
      const result = aggregateMarketSignal([
        inst({
          postingId: 'p1',
          requirementText: 'concert experience',
          classification: 'genuine_gap',
        }),
        inst({
          postingId: 'p2',
          requirementText: 'concert experience',
          classification: 'genuine_gap',
        }),
      ]);
      expect(result.buckets.certify).toHaveLength(0);
      const group = firstOf(result.buckets.build);
      expect(group.certification.mentioned).toBe(false);
      expect(group.certification.matchedTerms).toEqual([]);
    });

    it('an all-covered group that mentions a cert stays noAction (no purchase nudge)', () => {
      const result = aggregateMarketSignal([
        inst({ postingId: 'p1', requirementText: 'AWS Certification', classification: 'have' }),
        inst({ postingId: 'p2', requirementText: 'AWS Certification', classification: 'have' }),
      ]);
      expect(result.buckets.certify).toHaveLength(0);
      expect(firstOf(result.noAction).reason).toBe('covered_or_low_priority');
    });

    it('matches the singular and plural / cert token members', () => {
      for (const term of ['certified', 'certificate', 'cert', 'certifications']) {
        const result = aggregateMarketSignal([
          inst({
            postingId: 'p1',
            requirementText: `Must be ${term} in AWS`,
            classification: 'genuine_gap',
          }),
          inst({
            postingId: 'p2',
            requirementText: `Must be ${term} in AWS`,
            classification: 'genuine_gap',
          }),
        ]);
        expect(result.buckets.certify, `term ${term}`).toHaveLength(1);
      }
    });
  });

  describe('evidence weight (the engine coverage currency, never a fit score)', () => {
    it('best is the max coverage; direct beats partial beats adjacent beats none', () => {
      const result = aggregateMarketSignal([
        inst({ postingId: 'p1', evidenceStrengths: ['adjacent'] }),
        inst({ postingId: 'p2', evidenceStrengths: ['direct', 'partial'] }),
        inst({ postingId: 'p3', evidenceStrengths: [] }),
      ]);
      const group = firstOf(result.buckets.build);
      expect(group.bestEvidenceWeight).toBe(1);
    });

    it('mean coverage is round4 of the per-instance means', () => {
      const result = aggregateMarketSignal([
        inst({ postingId: 'p1', evidenceStrengths: ['direct'] }), // 1
        inst({ postingId: 'p2', evidenceStrengths: ['partial'] }), // 0.5
        inst({ postingId: 'p3', evidenceStrengths: ['adjacent'] }), // 0.25
      ]);
      const group = firstOf(result.buckets.build);
      // (1 + 0.5 + 0.25) / 3 = 0.5833...
      expect(group.meanEvidenceWeight).toBe(0.5833);
      expect(group.bestEvidenceWeight).toBe(1);
    });

    it('no-evidence group reports zero best and mean', () => {
      const result = aggregateMarketSignal([inst({ postingId: 'p1', evidenceStrengths: [] })]);
      const group = firstOf(result.buckets.build);
      expect(group.bestEvidenceWeight).toBe(0);
      expect(group.meanEvidenceWeight).toBe(0);
    });
  });

  it('emits full classification counts, overridden count, sorted distinct categories, and refs', () => {
    const result = aggregateMarketSignal([
      inst({
        postingId: 'p1',
        gapId: 'gA',
        fitReportId: 'r1',
        classification: 'genuine_gap',
        category: 'framework',
        userOverridden: true,
      }),
      inst({
        postingId: 'p2',
        gapId: 'gB',
        fitReportId: 'r2',
        classification: 'needs_refresh',
        category: 'language',
      }),
    ]);
    const group = firstOf(result.buckets.build);
    expect(group.classificationCounts).toEqual({
      have: 0,
      have_undemonstrated: 0,
      needs_refresh: 1,
      genuine_gap: 1,
      low_priority: 0,
    });
    expect(group.overriddenCount).toBe(1);
    expect(group.categories).toEqual(['framework', 'language']);
    expect(group.refs).toEqual([
      { gapId: 'gA', postingId: 'p1', fitReportId: 'r1', classification: 'genuine_gap' },
      { gapId: 'gB', postingId: 'p2', fitReportId: 'r2', classification: 'needs_refresh' },
    ]);
  });

  it('sorts groups within a bucket by postingCount desc then key asc', () => {
    const result = aggregateMarketSignal([
      inst({ postingId: 'p1', requirementText: 'Vue' }),
      inst({ postingId: 'p2', requirementText: 'React' }),
      inst({ postingId: 'p3', requirementText: 'React' }),
      inst({ postingId: 'p4', requirementText: 'React' }),
      inst({ postingId: 'p5', requirementText: 'Angular' }),
    ]);
    expect(result.buckets.build.map((group) => group.key)).toEqual(['React', 'Angular', 'Vue']);
  });

  it('is order-independent (shuffled input deep-equals) and deterministic (double-call)', () => {
    const instances = [
      inst({ postingId: 'p1', requirementText: 'React', classification: 'genuine_gap' }),
      inst({ postingId: 'p2', requirementText: 'React', classification: 'needs_refresh' }),
      inst({
        postingId: 'p3',
        requirementText: 'AWS Certification',
        classification: 'genuine_gap',
      }),
      inst({
        postingId: 'p4',
        requirementText: 'AWS Certification',
        classification: 'genuine_gap',
      }),
      inst({ postingId: 'p5', requirementText: 'Docker', classification: 'have' }),
    ];
    const first = aggregateMarketSignal(instances);
    const second = aggregateMarketSignal(instances);
    const shuffledResult = aggregateMarketSignal(shuffled(instances));
    expect(second).toEqual(first);
    expect(shuffledResult).toEqual(first);
  });

  it('result has exactly the counts-only keys - no merged/composite score', () => {
    const result = aggregateMarketSignal([inst()]);
    expect(Object.keys(result).sort()).toEqual([
      'buckets',
      'groupCount',
      'instanceCount',
      'noAction',
      'scorerVersion',
    ]);
    const group = firstOf(result.buckets.build);
    // Every group field is a count, a string label, an evidence weight, or a list.
    expect(Object.keys(group).sort()).toEqual([
      'bestEvidenceWeight',
      'categories',
      'certification',
      'classificationCounts',
      'displayText',
      'excludedPostingCount',
      'instanceCount',
      'key',
      'meanEvidenceWeight',
      'mustHavePostingCount',
      'niceToHavePostingCount',
      'overriddenCount',
      'postingCount',
      'refs',
    ]);
  });
});

describe('market-signal consts', () => {
  it('honesty copy is byte-pinned', () => {
    expect(MARKET_SIGNAL_HONESTY).toBe(
      "Deterministic counts over your saved postings' extracted requirements. Recurrence is exact-text recurrence, not meaning; classifications are as of each posting's latest fit report, not re-scored; certification mentions are keyword evidence, not advice.",
    );
  });

  it('CERTIFY_MIN_POSTINGS and BUCKET_SEVERITY are pinned', () => {
    expect(CERTIFY_MIN_POSTINGS).toBe(2);
    expect(BUCKET_SEVERITY).toEqual(['genuine_gap', 'needs_refresh', 'have_undemonstrated']);
  });

  it('CERTIFICATION_TERMS is the closed lowercase token set', () => {
    expect([...CERTIFICATION_TERMS].sort()).toEqual([
      'cert',
      'certificate',
      'certificates',
      'certification',
      'certifications',
      'certified',
    ]);
  });
});
