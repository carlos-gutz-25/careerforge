import { describe, expect, it } from 'vitest';

import {
  fitReportGapsResponseSchema,
  GAP_OVERRIDE_NOTE_MAX_CHARS,
  gapAssignmentSchema,
  gapOverrideBodySchema,
  gapOverrideResponseSchema,
  gapResponseSchema,
  type GapResponse,
} from './gaps.ts';

// All fixture data is fictional (RISKS P-01).

function gapRow(overrides: Partial<GapResponse> = {}): GapResponse {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    fitReportId: '22222222-2222-4222-8222-222222222222',
    requirementId: '33333333-3333-4333-8333-333333333333',
    classification: 'genuine_gap',
    engineClassification: 'genuine_gap',
    evaluator: null,
    confidence: null,
    rationale: 'No profile evidence links this requirement.',
    userOverridden: false,
    overrideNote: null,
    carriedVia: null,
    createdAt: '2026-01-02T03:04:05.000Z',
    requirementText: 'Kubernetes operations experience',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    ...overrides,
  };
}

describe('gapResponseSchema', () => {
  it('accepts a fresh engine-assigned row', () => {
    expect(gapResponseSchema.parse(gapRow())).toEqual(gapRow());
  });

  it('accepts an overridden row with note and carry audit', () => {
    const row = gapRow({
      classification: 'have_undemonstrated',
      userOverridden: true,
      overrideNote: 'Ran the fictional cluster at Example Corp; nothing public shows it.',
      carriedVia: 'requirement_id',
    });
    expect(gapResponseSchema.parse(row)).toEqual(row);
  });

  it('is strict — no extra keys, and no merged/aggregate field can ride along', () => {
    expect(gapResponseSchema.safeParse({ ...gapRow(), matchPercent: 62 }).success).toBe(false);
  });

  it('rejects a sixth bucket in either classification field', () => {
    expect(
      gapResponseSchema.safeParse(gapRow({ classification: 'wont_fix' as never })).success,
    ).toBe(false);
    expect(
      gapResponseSchema.safeParse(gapRow({ engineClassification: 'wont_fix' as never })).success,
    ).toBe(false);
  });

  it('rejects an unknown carry audit value and an empty rationale', () => {
    expect(gapResponseSchema.safeParse(gapRow({ carriedVia: 'history' as never })).success).toBe(
      false,
    );
    expect(gapResponseSchema.safeParse(gapRow({ rationale: '' })).success).toBe(false);
  });
});

describe('fitReportGapsResponseSchema', () => {
  it('accepts the R3 empty-by-design shape for pre-gaps reports', () => {
    expect(fitReportGapsResponseSchema.parse({ gaps: [], lostOverrides: 0 })).toEqual({
      gaps: [],
      lostOverrides: 0,
    });
  });

  it('accepts rows with a lost-override count and rejects a negative count', () => {
    expect(
      fitReportGapsResponseSchema.safeParse({ gaps: [gapRow()], lostOverrides: 2 }).success,
    ).toBe(true);
    expect(fitReportGapsResponseSchema.safeParse({ gaps: [], lostOverrides: -1 }).success).toBe(
      false,
    );
  });
});

describe('gapOverrideBodySchema (A2 full replacement)', () => {
  it('accepts an override with a note', () => {
    expect(gapOverrideBodySchema.parse({ classification: 'have', note: 'fictional note' })).toEqual(
      { classification: 'have', note: 'fictional note' },
    );
  });

  it('accepts note absent and note null — both mean the stored note is cleared', () => {
    expect(gapOverrideBodySchema.parse({ classification: 'low_priority' })).toEqual({
      classification: 'low_priority',
    });
    expect(gapOverrideBodySchema.parse({ classification: 'low_priority', note: null })).toEqual({
      classification: 'low_priority',
      note: null,
    });
  });

  it('accepts classification null — the D6 un-override', () => {
    expect(gapOverrideBodySchema.parse({ classification: null })).toEqual({ classification: null });
  });

  it('requires the classification key — a body without it is not a valid replacement', () => {
    expect(gapOverrideBodySchema.safeParse({ note: 'fictional' }).success).toBe(false);
    expect(gapOverrideBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a sixth bucket, an oversized note, and a U+0000 note', () => {
    expect(gapOverrideBodySchema.safeParse({ classification: 'wont_fix' }).success).toBe(false);
    expect(
      gapOverrideBodySchema.safeParse({
        classification: 'have',
        note: 'x'.repeat(GAP_OVERRIDE_NOTE_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
    expect(
      gapOverrideBodySchema.safeParse({ classification: 'have', note: 'a\u0000b' }).success,
    ).toBe(false);
  });

  it('is strict — unknown keys are rejected', () => {
    expect(
      gapOverrideBodySchema.safeParse({ classification: 'have', reason: 'nope' }).success,
    ).toBe(false);
  });
});

describe('gapAssignmentSchema', () => {
  it('accepts a classifier output row (with evaluator + confidence) and stays strict', () => {
    const assignment = {
      requirementId: '33333333-3333-4333-8333-333333333333',
      classification: 'needs_refresh',
      evaluator: 'skill_evidence',
      confidence: null,
      rationale: 'Rusty skill (Kubernetes (rusty, 2 yrs)); past competence, refreshable.',
    };
    expect(gapAssignmentSchema.parse(assignment)).toEqual(assignment);
    expect(gapAssignmentSchema.safeParse({ ...assignment, score: 0.5 }).success).toBe(false);
  });

  it('accepts an M12-02 evidence-status row (satisfied_fact, seniority_threshold, high)', () => {
    const assignment = {
      requirementId: '44444444-4444-4444-8444-444444444444',
      classification: 'satisfied_fact',
      evaluator: 'seniority_threshold',
      confidence: 'high',
      rationale: 'Seniority threshold met: 5+ years demanded vs computed span ~8 years.',
    };
    expect(gapAssignmentSchema.parse(assignment)).toEqual(assignment);
  });

  it('rejects a non-member classification, a bad evaluator, and an empty rationale', () => {
    const base = {
      requirementId: 'x',
      classification: 'have',
      evaluator: 'skill_evidence',
      confidence: null,
      rationale: 'r',
    };
    expect(gapAssignmentSchema.safeParse({ ...base, classification: 'wont_fix' }).success).toBe(
      false,
    );
    expect(gapAssignmentSchema.safeParse({ ...base, evaluator: 'astrology' }).success).toBe(false);
    // Missing evaluator entirely is rejected (the classifier always names one).
    const noEvaluator = {
      requirementId: 'x',
      classification: 'have',
      confidence: null,
      rationale: 'r',
    };
    expect(gapAssignmentSchema.safeParse(noEvaluator).success).toBe(false);
    expect(gapAssignmentSchema.safeParse({ ...base, rationale: '' }).success).toBe(false);
  });
});

describe('gapOverrideResponseSchema', () => {
  it('is the one row contract shared with the GET', () => {
    expect(gapOverrideResponseSchema).toBe(gapResponseSchema);
  });
});
