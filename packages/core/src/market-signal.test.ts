import { describe, expect, it } from 'vitest';

import {
  marketSignalGroupSchema,
  marketSignalNoActionSchema,
  marketSignalReportSchema,
  type MarketSignalGroup,
  type MarketSignalReport,
} from './market-signal.ts';

// M9-02: the wire schemas accept a well-formed report and REJECT any smuggled key
// (the never-one-merged-score wall is structural via z.strictObject). The full
// schema-engine compatibility - that the REAL aggregator output parses - is pinned
// end-to-end by the route test, where scoring + core are both in scope.

const group: MarketSignalGroup = {
  key: 'react',
  displayText: 'React',
  postingCount: 2,
  instanceCount: 3,
  mustHavePostingCount: 2,
  niceToHavePostingCount: 0,
  excludedPostingCount: 0,
  bestEvidenceWeight: 1,
  meanEvidenceWeight: 0.5,
  classificationCounts: {
    have: 0,
    have_undemonstrated: 0,
    needs_refresh: 0,
    genuine_gap: 3,
    low_priority: 0,
    unknown: 0,
    satisfied_fact: 0,
    not_applicable: 0,
  },
  overriddenCount: 0,
  needsInputCount: 0,
  categories: ['framework'],
  refs: [{ gapId: 'g1', postingId: 'p1', fitReportId: 'r1', classification: 'genuine_gap' }],
  certification: { mentioned: false, postingCount: 0, matchedTerms: [] },
};

const report: MarketSignalReport = {
  scorerVersion: 1,
  honesty: 'Deterministic counts over your saved postings.',
  cohort: {
    postingsConsidered: 3,
    postingsWithSignal: 2,
    postingsWithoutReport: 1,
    postingsArchived: 0,
    excludedVerdictPostings: 0,
    draftReports: 1,
    reviewedReports: 1,
    unscoredRequirementsInCohort: 0,
  },
  buckets: { sharpen: [], prove: [], build: [group], certify: [] },
  noAction: [{ ...group, reason: 'covered_or_low_priority' }],
  groupCount: 2,
  instanceCount: 3,
};

describe('marketSignalReportSchema', () => {
  it('accepts a well-formed report', () => {
    expect(() => marketSignalReportSchema.parse(report)).not.toThrow();
  });

  it('rejects a smuggled composite-score key at the top level (never-one-merged-score)', () => {
    const smuggled = { ...report, marketScore: 0.87 };
    expect(marketSignalReportSchema.safeParse(smuggled).success).toBe(false);
  });

  it('rejects a smuggled key inside a group', () => {
    const smuggled = {
      ...report,
      buckets: { ...report.buckets, build: [{ ...group, blendedScore: 0.5 }] },
    };
    expect(marketSignalReportSchema.safeParse(smuggled).success).toBe(false);
  });

  it('rejects an unknown gap classification in the counts', () => {
    const bad = { ...group, classificationCounts: { ...group.classificationCounts, bogus: 1 } };
    expect(marketSignalGroupSchema.safeParse(bad).success).toBe(false);
  });

  it('requires the noAction reason', () => {
    expect(marketSignalNoActionSchema.safeParse(group).success).toBe(false);
    expect(
      marketSignalNoActionSchema.safeParse({ ...group, reason: 'all_postings_excluded' }).success,
    ).toBe(true);
  });

  it('rejects an unknown noAction reason', () => {
    expect(
      marketSignalNoActionSchema.safeParse({ ...group, reason: 'made_up_reason' }).success,
    ).toBe(false);
  });
});
