import { describe, expect, it } from 'vitest';

import {
  AGGREGATE_CLAIM_SHAPE_RULES,
  CLAIM_SHAPE_RULES,
  RESUME_CLAIM_MAX_CITATIONS,
  RESUME_CLAIM_MIN_CITATIONS,
  RESUME_CLAIM_SECTIONS,
  RESUME_CLAIM_TEXT_MAX_CHARS,
  RESUME_MAX_CLAIMS,
  RESUME_MAX_CLAIMS_PER_EXPERIENCE,
  RESUME_MAX_CLAIMS_PER_PROJECT,
  RESUME_SUMMARY_TOTAL_MAX_CHARS,
  isAggregateOnlyViolationSet,
  resumeClaimDraftSchema,
  trimAggregateOverflow,
  type ClaimProvenanceLaw,
  type ClaimShapeRule,
  type ResumeClaimDraft,
  type ResumeClaimSection,
  type ResumeGateViolation,
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

// M15-03 - the aggregate-cap DEGRADE path. Pure/deterministic, so it is unit
// tested in isolation here; the PROVABLE-IDENTITY claim it rests on (trimmed set
// == the gate's flagged set) needs the real gate and is pinned in
// packages/scoring, which can import both. All data fictional.

const claim = (
  section: ResumeClaimSection,
  text: string,
  entityRef: string | null = null,
): ResumeClaimDraft => ({ section, text, entityRef, citationRefs: ['e1'] });

const violation = (
  claimIndex: number,
  section: ResumeClaimSection,
  detail?: ClaimShapeRule[],
  law: ClaimProvenanceLaw = 'shape',
): ResumeGateViolation =>
  detail === undefined ? { claimIndex, section, law } : { claimIndex, section, law, detail };

describe('AGGREGATE_CLAIM_SHAPE_RULES (drift guard)', () => {
  it('is a subset of CLAIM_SHAPE_RULES and names exactly the four aggregate caps', () => {
    for (const rule of AGGREGATE_CLAIM_SHAPE_RULES) {
      expect(CLAIM_SHAPE_RULES).toContain(rule);
    }
    expect([...AGGREGATE_CLAIM_SHAPE_RULES].sort()).toEqual(
      ['claim_count_cap', 'experience_claim_cap', 'project_claim_cap', 'summary_total_cap'].sort(),
    );
    // The per-claim four must stay OUT: they are defects IN a claim and reject.
    for (const perClaim of [
      'entity_ref_forbidden',
      'entity_ref_missing',
      'entity_ref_unknown',
      'claim_text_cap',
    ]) {
      expect(AGGREGATE_CLAIM_SHAPE_RULES).not.toContain(perClaim);
    }
    expect(AGGREGATE_CLAIM_SHAPE_RULES).toHaveLength(4);
  });
});

describe('isAggregateOnlyViolationSet (condition 1 wall)', () => {
  it('is true only when every violation is an aggregate-cap shape breach', () => {
    expect(isAggregateOnlyViolationSet([violation(0, 'summary', ['summary_total_cap'])])).toBe(
      true,
    );
    expect(
      isAggregateOnlyViolationSet([
        violation(0, 'summary', ['summary_total_cap']),
        violation(1, 'experience', ['experience_claim_cap']),
      ]),
    ).toBe(true);
  });

  it('is false when ANY truthfulness law is present - degrade is never a repair path', () => {
    expect(
      isAggregateOnlyViolationSet([
        violation(0, 'summary', ['summary_total_cap']),
        violation(1, 'experience', undefined, 'numeric'),
      ]),
    ).toBe(false);
  });

  it('is false when a PER-CLAIM shape defect rides along', () => {
    expect(
      isAggregateOnlyViolationSet([
        violation(0, 'summary', ['summary_total_cap']),
        violation(1, 'experience', ['claim_text_cap']),
      ]),
    ).toBe(false);
    // mixed detail on ONE violation is equally disqualifying
    expect(
      isAggregateOnlyViolationSet([
        violation(0, 'summary', ['claim_text_cap', 'summary_total_cap']),
      ]),
    ).toBe(false);
  });

  it('is false for a shape violation carrying no detail (conservative, ADR-0018 over-flag)', () => {
    expect(isAggregateOnlyViolationSet([violation(0, 'summary')])).toBe(false);
    expect(isAggregateOnlyViolationSet([violation(0, 'summary', [])])).toBe(false);
  });

  it('is false for an EMPTY set - nothing to degrade, that case is plain ok', () => {
    expect(isAggregateOnlyViolationSet([])).toBe(false);
  });
});

describe('trimAggregateOverflow', () => {
  it('drops exactly the flagged indices and preserves the surviving order', () => {
    const claims = [
      claim('summary', 'a'),
      claim('summary', 'b'),
      claim('experience', 'c', 'exp-1'),
      claim('experience', 'd', 'exp-1'),
    ];
    const result = trimAggregateOverflow(claims, [
      violation(1, 'summary', ['summary_total_cap']),
      violation(3, 'experience', ['experience_claim_cap']),
    ]);
    expect(result.claims.map((c) => c.text)).toEqual(['a', 'c']);
    expect(result.disclosure.droppedCount).toBe(2);
  });

  it('discloses which caps fired and how many claims went from which section', () => {
    const claims = [claim('summary', 'a'), claim('summary', 'b'), claim('project', 'c', 'proj-1')];
    const result = trimAggregateOverflow(claims, [
      violation(1, 'summary', ['summary_total_cap']),
      violation(2, 'project', ['project_claim_cap']),
    ]);
    expect(result.disclosure.caps).toEqual(['project_claim_cap', 'summary_total_cap']);
    expect(result.disclosure.droppedBySection).toEqual([
      { section: 'summary', count: 1 },
      { section: 'project', count: 1 },
    ]);
  });

  it('omits sections that lost nothing rather than reporting a zero', () => {
    const claims = [claim('summary', 'a'), claim('experience', 'b', 'exp-1')];
    const result = trimAggregateOverflow(claims, [violation(0, 'summary', ['summary_total_cap'])]);
    expect(result.disclosure.droppedBySection).toEqual([{ section: 'summary', count: 1 }]);
  });

  it('can trim to zero - the caller, not the trim, decides that becomes `empty`', () => {
    const claims = [claim('summary', 'a')];
    const result = trimAggregateOverflow(claims, [violation(0, 'summary', ['summary_total_cap'])]);
    expect(result.claims).toEqual([]);
    expect(result.disclosure.droppedCount).toBe(1);
  });

  it('is a no-op on an empty violation set', () => {
    const claims = [claim('summary', 'a'), claim('experience', 'b', 'exp-1')];
    const result = trimAggregateOverflow(claims, []);
    expect(result.claims).toEqual(claims);
    expect(result.disclosure).toEqual({ caps: [], droppedBySection: [], droppedCount: 0 });
  });

  it('deduplicates a cap reported across many claims', () => {
    const claims = [claim('summary', 'a'), claim('summary', 'b'), claim('summary', 'c')];
    const result = trimAggregateOverflow(claims, [
      violation(1, 'summary', ['summary_total_cap']),
      violation(2, 'summary', ['summary_total_cap']),
    ]);
    expect(result.disclosure.caps).toEqual(['summary_total_cap']);
    expect(result.disclosure.droppedBySection).toEqual([{ section: 'summary', count: 2 }]);
  });
});
