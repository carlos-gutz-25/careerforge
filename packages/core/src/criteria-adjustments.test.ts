import { describe, expect, it } from 'vitest';

import {
  formatStageChangeDetail,
  furthestRankedStage,
  parseStageChangeDetail,
  APPLICATION_STAGES,
  type ApplicationStage,
} from './index.ts';
import {
  applyCriteriaAdjustment,
  criteriaAdjustmentSuggestionSchema,
  confirmCriteriaAdjustmentBodySchema,
  type CriteriaAdjustmentSuggestion,
} from './criteria-adjustments.ts';
import { searchCriteriaSchema, type SearchCriteriaData } from './criteria.ts';

// M4-02 core contracts — pure. ALL data fictional (Alex Rivera vocabulary).

const CRITERIA: SearchCriteriaData = {
  hardFilters: { employment_type: ['full_time'] },
  positiveSignals: {
    role: ['staff_engineer', 'tech_lead'],
    technologies: ['typescript', 'go'],
    problem_domains: ['developer_tools', 'observability'],
    work_arrangement: ['remote'],
    scope: ['zero_to_one'],
  },
  negativeSignals: ['on_call_heavy', 'legacy_php'],
  forceLowestPriority: { industry: ['adtech'] },
  compBounds: { currency: 'usd', base_preferred_min: 180000, base_preferred_max: 240000 },
};

const VALID_EVIDENCE = {
  matched: { total: 4, progressed: 0 },
  unmatched: { total: 6, progressed: 3 },
  matchedPostings: [],
};

describe('applyCriteriaAdjustment', () => {
  it('removes a present positive-signal slug from its category', () => {
    const next = applyCriteriaAdjustment(CRITERIA, {
      kind: 'remove_positive_signal',
      category: 'technologies',
      slug: 'go',
    });
    expect(next?.positiveSignals.technologies).toEqual(['typescript']);
    // Other categories untouched; the input is not mutated.
    expect(next?.positiveSignals.role).toEqual(['staff_engineer', 'tech_lead']);
    expect(CRITERIA.positiveSignals.technologies).toEqual(['typescript', 'go']);
  });

  it('removes a present negative-signal slug from the flat list', () => {
    const next = applyCriteriaAdjustment(CRITERIA, {
      kind: 'remove_negative_signal',
      category: null,
      slug: 'legacy_php',
    });
    expect(next?.negativeSignals).toEqual(['on_call_heavy']);
  });

  it('returns undefined when the slug is absent (drift)', () => {
    expect(
      applyCriteriaAdjustment(CRITERIA, {
        kind: 'remove_positive_signal',
        category: 'technologies',
        slug: 'rust',
      }),
    ).toBeUndefined();
    expect(
      applyCriteriaAdjustment(CRITERIA, {
        kind: 'remove_negative_signal',
        category: null,
        slug: 'never_here',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when removal would empty a min(1) list', () => {
    const oneEach: SearchCriteriaData = {
      ...CRITERIA,
      positiveSignals: { ...CRITERIA.positiveSignals, work_arrangement: ['remote'] },
      negativeSignals: ['on_call_heavy'],
    };
    expect(
      applyCriteriaAdjustment(oneEach, {
        kind: 'remove_positive_signal',
        category: 'work_arrangement',
        slug: 'remote',
      }),
    ).toBeUndefined();
    expect(
      applyCriteriaAdjustment(oneEach, {
        kind: 'remove_negative_signal',
        category: null,
        slug: 'on_call_heavy',
      }),
    ).toBeUndefined();
  });

  it('every applier output is undefined or re-parses under searchCriteriaSchema', () => {
    // The slice-1 planted-FAIL(b) property: dropping the min(1) guard in the
    // applier makes an emptied category/list escape as an INVALID criteria here.
    // Property = the applier NEVER returns an invalid criteria (undefined instead).
    const oneEach: SearchCriteriaData = {
      ...CRITERIA,
      positiveSignals: { ...CRITERIA.positiveSignals, work_arrangement: ['remote'] },
      negativeSignals: ['on_call_heavy'],
    };
    const cases: Parameters<typeof applyCriteriaAdjustment>[] = [
      [CRITERIA, { kind: 'remove_positive_signal', category: 'technologies', slug: 'go' }],
      [oneEach, { kind: 'remove_positive_signal', category: 'work_arrangement', slug: 'remote' }],
      [oneEach, { kind: 'remove_negative_signal', category: null, slug: 'on_call_heavy' }],
    ];
    for (const [criteria, target] of cases) {
      const next = applyCriteriaAdjustment(criteria, target);
      if (next !== undefined) expect(searchCriteriaSchema.safeParse(next).success).toBe(true);
    }
    // The non-emptying case still yields a defined, valid result.
    const removed = applyCriteriaAdjustment(CRITERIA, {
      kind: 'remove_positive_signal',
      category: 'technologies',
      slug: 'go',
    });
    expect(removed).toBeDefined();
  });
});

describe('suggestion wire schema (structured-only, OD-4)', () => {
  const base: CriteriaAdjustmentSuggestion = {
    kind: 'remove_positive_signal',
    category: 'technologies',
    slug: 'go',
    evidence: VALID_EVIDENCE,
  };

  it('accepts a well-formed positive-signal suggestion', () => {
    expect(criteriaAdjustmentSuggestionSchema.safeParse(base).success).toBe(true);
  });

  it('rejects any free-text field (no note/rationale on the wire)', () => {
    const withNote = { ...base, note: 'this signal is hurting me' };
    expect(criteriaAdjustmentSuggestionSchema.safeParse(withNote).success).toBe(false);
  });

  it('requires a category iff the kind is remove_positive_signal', () => {
    expect(criteriaAdjustmentSuggestionSchema.safeParse({ ...base, category: null }).success).toBe(
      false,
    );
    expect(
      criteriaAdjustmentSuggestionSchema.safeParse({
        kind: 'remove_negative_signal',
        category: 'technologies',
        slug: 'go',
        evidence: VALID_EVIDENCE,
      }).success,
    ).toBe(false);
    expect(
      criteriaAdjustmentSuggestionSchema.safeParse({
        kind: 'remove_negative_signal',
        category: null,
        slug: 'go',
        evidence: VALID_EVIDENCE,
      }).success,
    ).toBe(true);
  });

  it('confirm body carries the CAS pin and the same category law', () => {
    const ok = confirmCriteriaAdjustmentBodySchema.safeParse({
      kind: 'remove_negative_signal',
      category: null,
      slug: 'legacy_php',
      expectedUpdatedAt: '2026-07-25T00:00:00.000Z',
    });
    expect(ok.success).toBe(true);
    // Missing the pin is a validation error (no blind overwrite path exists).
    expect(
      confirmCriteriaAdjustmentBodySchema.safeParse({
        kind: 'remove_negative_signal',
        category: null,
        slug: 'legacy_php',
      }).success,
    ).toBe(false);
  });
});

describe('stage progression helpers', () => {
  it('formats and parses a stage_change detail round-trip', () => {
    for (const from of APPLICATION_STAGES) {
      for (const to of APPLICATION_STAGES) {
        const detail = formatStageChangeDetail(from, to);
        expect(parseStageChangeDetail(detail)).toEqual({ from, to });
      }
    }
  });

  it('uses the exact M1-03 detail bytes (space, U+2192, space)', () => {
    expect(formatStageChangeDetail('applied', 'screen')).toBe('applied \u2192 screen');
  });

  it('parses undefined when the separator is absent', () => {
    expect(parseStageChangeDetail('applied to screen')).toBeUndefined();
    expect(parseStageChangeDetail('')).toBeUndefined();
  });

  it('ranks reached depth; rejected/withdrawn are terminal markers, not depths', () => {
    const set = (...stages: ApplicationStage[]): Set<ApplicationStage> => new Set(stages);
    expect(furthestRankedStage(set('considering', 'applied', 'screen'))).toBe('screen');
    // rejected-after-interview still counts interview as furthest reached.
    expect(furthestRankedStage(set('applied', 'interview', 'rejected'))).toBe('interview');
    // only terminal markers ⇒ no ranked depth.
    expect(furthestRankedStage(set('withdrawn'))).toBeUndefined();
    expect(furthestRankedStage(set('rejected'))).toBeUndefined();
  });
});
