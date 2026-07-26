import {
  applyCriteriaAdjustment,
  formatStageChangeDetail,
  searchCriteriaSchema,
  type SearchCriteriaData,
} from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import {
  MIN_RESOLVED_ANALYZABLE,
  suggestCriteriaAdjustments,
  type SuggestCriteriaApplication,
  type SuggestCriteriaRequirement,
} from './index.ts';

// M4-02 criteria-adjustment engine — pure, deterministic. ALL data fictional
// (Alex Rivera vocabulary, invented ids). The MIN_RESOLVED_ANALYZABLE gate is
// the SLICE-1 planted-FAIL(a) target: removing it flips the below-threshold
// status from insufficient_data to ok (see the boundary test).

const CRITERIA: SearchCriteriaData = {
  hardFilters: { employment_type: ['full_time'] },
  positiveSignals: {
    role: ['staff_engineer', 'tech_lead'],
    technologies: ['typescript', 'go'],
    problem_domains: ['developer_tools', 'observability'],
    work_arrangement: ['remote', 'hybrid'],
    scope: ['zero_to_one', 'greenfield'],
  },
  negativeSignals: ['on_call_heavy', 'legacy_php'],
  forceLowestPriority: { industry: ['adtech'] },
  compBounds: { currency: 'usd', base_preferred_min: 180000, base_preferred_max: 240000 },
};

const req = (text: string): SuggestCriteriaRequirement[] => [{ text, sourceQuote: text }];

let counter = 0;
function app(over: Partial<SuggestCriteriaApplication> = {}): SuggestCriteriaApplication {
  counter += 1;
  const id = `app-${counter}`;
  return {
    applicationId: id,
    postingId: `posting-${id}`,
    company: 'Fictional Labs',
    title: 'Staff Engineer',
    appliedOn: '2026-06-01',
    currentStage: 'applied',
    stageTrail: [],
    requirements: req('TypeScript required'),
    ...over,
  };
}

/** A resolved-progressed application (reached a screen). */
const progressed = (reqText: string): SuggestCriteriaApplication =>
  app({
    currentStage: 'screen',
    stageTrail: [formatStageChangeDetail('applied', 'screen')],
    requirements: req(reqText),
  });

/** A resolved application rejected before ever reaching a screen. */
const rejectedEarly = (reqText: string): SuggestCriteriaApplication =>
  app({
    currentStage: 'rejected',
    stageTrail: [formatStageChangeDetail('applied', 'rejected')],
    requirements: req(reqText),
  });

describe('cohort classification (totals)', () => {
  it('classifies every censoring disposition and discloses each count', () => {
    counter = 0;
    const applications: SuggestCriteriaApplication[] = [
      progressed('TypeScript required'), // resolved + analyzable
      rejectedEarly('TypeScript required'), // resolved + analyzable
      app({ currentStage: 'applied' }), // in-flight (applied, no terminal)
      app({
        currentStage: 'withdrawn',
        stageTrail: [formatStageChangeDetail('applied', 'withdrawn')],
      }), // withdrawn without progression → censored
      app({
        currentStage: 'rejected',
        stageTrail: [formatStageChangeDetail('applied', 'rejected')],
        requirements: null,
      }), // resolved but unextracted → withoutRequirements
      app({ currentStage: 'considering', requirements: null }), // not exposed, in-flight
    ];

    const { totals } = suggestCriteriaAdjustments({ criteria: CRITERIA, applications });
    expect(totals.applications).toBe(6);
    expect(totals.analyzable).toBe(2);
    expect(totals.resolved).toBe(3); // 2 analyzable + 1 withoutRequirements
    expect(totals.withoutRequirements).toBe(1);
    expect(totals.withdrawnCensored).toBe(1);
    expect(totals.inFlight).toBe(2); // the applied one + the considering one
    // exposed = applied|screen|interview|offer|rejected present. considering-only
    // is NOT exposed; the other 5 all are.
    expect(totals.exposed).toBe(5);
  });

  it('counts withdrawn-after-progression as progressed, not censored', () => {
    counter = 0;
    const applications = [
      app({
        currentStage: 'withdrawn',
        stageTrail: [
          formatStageChangeDetail('applied', 'interview'),
          formatStageChangeDetail('interview', 'withdrawn'),
        ],
        requirements: req('TypeScript required'),
      }),
    ];
    const { totals } = suggestCriteriaAdjustments({ criteria: CRITERIA, applications });
    expect(totals.withdrawnCensored).toBe(0);
    expect(totals.resolved).toBe(1);
    expect(totals.analyzable).toBe(1);
  });
});

describe('insufficient-data gate (MIN_RESOLVED_ANALYZABLE)', () => {
  it('below the gate: insufficient_data, zero suggestions, totals still disclosed', () => {
    counter = 0;
    // 7 analyzable applications — below the gate of 8. The PLANTED-FAIL(a)
    // boundary: with the gate removed, status flips to 'ok'.
    expect(MIN_RESOLVED_ANALYZABLE).toBe(8);
    const applications = [
      ...Array.from({ length: 4 }, () => rejectedEarly('Go required')),
      ...Array.from({ length: 3 }, () => progressed('TypeScript required')),
    ];
    const result = suggestCriteriaAdjustments({ criteria: CRITERIA, applications });
    expect(result.totals.analyzable).toBe(7);
    expect(result.status).toBe('insufficient_data');
    expect(result.suggestions).toEqual([]);
    // Thresholds are disclosed to the caller (the api rides them onto the wire).
  });
});

describe('remove_positive_signal trigger', () => {
  it('fires when a signal never progresses but its counterpart does', () => {
    counter = 0;
    // 4 postings match "go" (all rejected early), 4 do not (2 progress).
    const applications = [
      ...Array.from({ length: 4 }, () => rejectedEarly('Go required')),
      ...Array.from({ length: 2 }, () => progressed('TypeScript required')),
      ...Array.from({ length: 2 }, () => rejectedEarly('TypeScript required')),
    ];
    const result = suggestCriteriaAdjustments({ criteria: CRITERIA, applications });
    expect(result.status).toBe('ok');
    expect(result.suggestions).toHaveLength(1);
    const suggestion = result.suggestions[0]!;
    expect(suggestion.kind).toBe('remove_positive_signal');
    expect(suggestion.category).toBe('technologies');
    expect(suggestion.slug).toBe('go');
    expect(suggestion.evidence.matched).toEqual({ total: 4, progressed: 0 });
    expect(suggestion.evidence.unmatched).toEqual({ total: 4, progressed: 2 });
    expect(suggestion.evidence.matchedPostings).toHaveLength(4);
    expect(
      suggestion.evidence.matchedPostings.every((p) => p.outcome === 'rejected_before_screen'),
    ).toBe(true);
    // Applying it must produce valid criteria (the wire↔applier contract).
    const next = applyCriteriaAdjustment(CRITERIA, suggestion);
    expect(next?.positiveSignals.technologies).toEqual(['typescript']);
    expect(searchCriteriaSchema.safeParse(next).success).toBe(true);
  });

  it('does NOT fire when the counterpart cell lacks enough progressions', () => {
    counter = 0;
    // Only 1 progression among unmatched (< MIN_COUNTER_PROGRESSED).
    const applications = [
      ...Array.from({ length: 4 }, () => rejectedEarly('Go required')),
      progressed('TypeScript required'),
      ...Array.from({ length: 3 }, () => rejectedEarly('TypeScript required')),
    ];
    const result = suggestCriteriaAdjustments({ criteria: CRITERIA, applications });
    expect(result.status).toBe('ok');
    expect(result.suggestions).toEqual([]);
  });

  it('is suppressed when the category would fall below min(1)', () => {
    counter = 0;
    const oneTech: SearchCriteriaData = {
      ...CRITERIA,
      positiveSignals: { ...CRITERIA.positiveSignals, technologies: ['go'] },
    };
    const applications = [
      ...Array.from({ length: 4 }, () => rejectedEarly('Go required')),
      ...Array.from({ length: 2 }, () => progressed('TypeScript required')),
      ...Array.from({ length: 2 }, () => rejectedEarly('TypeScript required')),
    ];
    const result = suggestCriteriaAdjustments({ criteria: oneTech, applications });
    expect(result.suggestions.find((s) => s.slug === 'go')).toBeUndefined();
  });
});

describe('remove_negative_signal trigger', () => {
  it('fires when a penalized signal progresses at least as well as its counterpart', () => {
    counter = 0;
    // 4 postings match "legacy_php" (3 progress), 4 do not (1 progresses).
    const applications = [
      ...Array.from({ length: 3 }, () => progressed('Legacy PHP maintenance')),
      rejectedEarly('Legacy PHP maintenance'),
      progressed('TypeScript required'),
      ...Array.from({ length: 3 }, () => rejectedEarly('TypeScript required')),
    ];
    const result = suggestCriteriaAdjustments({ criteria: CRITERIA, applications });
    const negative = result.suggestions.find((s) => s.kind === 'remove_negative_signal');
    expect(negative?.slug).toBe('legacy_php');
    expect(negative?.category).toBeNull();
    expect(negative?.evidence.matched).toEqual({ total: 4, progressed: 3 });
    expect(negative?.evidence.unmatched).toEqual({ total: 4, progressed: 1 });
    const next = applyCriteriaAdjustment(CRITERIA, negative!);
    expect(next?.negativeSignals).toEqual(['on_call_heavy']);
  });
});

describe('determinism + ordering', () => {
  it('orders suggestions by (kind, category asc, slug asc)', () => {
    counter = 0;
    const applications = [
      ...Array.from({ length: 4 }, () => rejectedEarly('Go required')), // positive go fires
      ...Array.from({ length: 3 }, () => progressed('Legacy PHP maintenance')), // negative legacy_php fires
      rejectedEarly('Legacy PHP maintenance'),
      ...Array.from({ length: 4 }, () => progressed('TypeScript required')), // neutral progressions
    ];
    const result = suggestCriteriaAdjustments({ criteria: CRITERIA, applications });
    expect(result.suggestions.map((s) => `${s.kind}:${s.slug}`)).toEqual([
      'remove_positive_signal:go',
      'remove_negative_signal:legacy_php',
    ]);
  });

  it('is invariant to input application order', () => {
    counter = 0;
    const applications: SuggestCriteriaApplication[] = [
      ...Array.from({ length: 4 }, () => rejectedEarly('Go required')),
      ...Array.from({ length: 2 }, () => progressed('TypeScript required')),
      ...Array.from({ length: 2 }, () => rejectedEarly('TypeScript required')),
    ];
    const forward = suggestCriteriaAdjustments({ criteria: CRITERIA, applications });
    const reversed = suggestCriteriaAdjustments({
      criteria: CRITERIA,
      applications: [...applications].reverse(),
    });
    expect(JSON.stringify(reversed.suggestions)).toBe(JSON.stringify(forward.suggestions));
  });
});
