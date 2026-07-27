import { describe, expect, it } from 'vitest';

import {
  RESUME_CLAIM_MAX_CITATIONS,
  RESUME_CLAIM_MIN_CITATIONS,
  RESUME_CLAIM_SECTIONS,
  RESUME_CLAIM_TEXT_MAX_CHARS,
  RESUME_MAX_CLAIMS,
  RESUME_MAX_CLAIMS_PER_EXPERIENCE,
  RESUME_MAX_CLAIMS_PER_PROJECT,
  RESUME_SUMMARY_TOTAL_MAX_CHARS,
  resumeClaimDraftSchema,
  type ResumeClaimDraft,
} from './index.ts';

// M6-02 core claim contracts - pure shape tests. All data fictional. The gate
// (packages/scoring) owns every cross-field / aggregate law; here we pin ONLY
// the exported caps and the zod ELEMENT shape (so a value change is a visible
// diff and M6-03/M6-04 cannot drift from this one definition).

describe('caps (exported-value pins)', () => {
  it('holds the caps M6-03/M6-04/gate share', () => {
    expect(RESUME_CLAIM_TEXT_MAX_CHARS).toBe(300);
    expect(RESUME_SUMMARY_TOTAL_MAX_CHARS).toBe(600);
    expect(RESUME_CLAIM_MIN_CITATIONS).toBe(1);
    expect(RESUME_CLAIM_MAX_CITATIONS).toBe(4);
    expect(RESUME_MAX_CLAIMS).toBe(40);
    expect(RESUME_MAX_CLAIMS_PER_EXPERIENCE).toBe(6);
    expect(RESUME_MAX_CLAIMS_PER_PROJECT).toBe(4);
  });

  it('lists exactly the three claim sections in order', () => {
    expect(RESUME_CLAIM_SECTIONS).toEqual(['summary', 'experience', 'project']);
  });
});

const valid: ResumeClaimDraft = {
  text: 'Cut p99 latency by 40 percent across the ingest tier.',
  section: 'experience',
  entityRef: 'exp-1',
  citationRefs: ['ev-1'],
};

describe('resumeClaimDraftSchema (element shape only)', () => {
  it('accepts a well-formed claim', () => {
    expect(resumeClaimDraftSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a summary claim with a null entityRef', () => {
    const summary: ResumeClaimDraft = { ...valid, section: 'summary', entityRef: null };
    expect(resumeClaimDraftSchema.parse(summary)).toEqual(summary);
  });

  it('accepts the max citation cardinality', () => {
    const four: ResumeClaimDraft = { ...valid, citationRefs: ['a', 'b', 'c', 'd'] };
    expect(resumeClaimDraftSchema.safeParse(four).success).toBe(true);
  });

  const rejects: Array<[string, unknown]> = [
    ['an unknown section', { ...valid, section: 'headline' }],
    [
      'a missing entityRef key (must be present, may be null)',
      { text: valid.text, section: 'summary', citationRefs: ['ev-1'] },
    ],
    ['zero citations (below min)', { ...valid, citationRefs: [] }],
    ['five citations (above max)', { ...valid, citationRefs: ['a', 'b', 'c', 'd', 'e'] }],
    ['an extra key (strictObject)', { ...valid, confidence: 0.9 }],
    ['a non-string entityRef', { ...valid, entityRef: 7 }],
    ['a non-string citation ref', { ...valid, citationRefs: [7] }],
  ];

  it.each(rejects)('rejects %s', (_label, input) => {
    expect(resumeClaimDraftSchema.safeParse(input).success).toBe(false);
  });

  it('does NOT enforce the 300-char text cap (that is a gate law, over-flag not 400)', () => {
    const long: ResumeClaimDraft = { ...valid, text: 'x'.repeat(RESUME_CLAIM_TEXT_MAX_CHARS + 50) };
    expect(resumeClaimDraftSchema.safeParse(long).success).toBe(true);
  });
});
