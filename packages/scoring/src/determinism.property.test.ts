import { type FitInput } from '@careerforge/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { classifyGaps } from './classify-gaps.ts';
import { scoreFit } from './score-fit.ts';

// The determinism property (story AC + A4): same input SET -> byte-identical
// output. scoreFit canonicalizes internally, so permuting EVERY input array —
// requirements included, no carve-outs — must not change one bit of the
// report. Seeded: the run is reproducible, and any failure prints its
// counterexample permutation.

const BASE: FitInput = {
  requirements: [
    {
      id: 'dddd0001-0000-4000-8000-000000000000',
      kind: 'must_have',
      category: 'language',
      text: 'TypeScript expertise',
      sourceQuote: '5+ years of TypeScript',
      quoteVerified: true,
      confidence: 0.9,
      position: 0,
    },
    {
      id: 'dddd0002-0000-4000-8000-000000000000',
      kind: 'must_have',
      category: 'framework',
      text: 'Vue 3 frontend work',
      sourceQuote: 'experience with Vue 3',
      quoteVerified: true,
      confidence: 0.85,
      position: 1,
    },
    {
      id: 'dddd0003-0000-4000-8000-000000000000',
      kind: 'nice_to_have',
      category: 'framework',
      text: 'Kubernetes deployments',
      sourceQuote: 'Kubernetes a plus',
      quoteVerified: true,
      confidence: 0.8,
      position: 2,
    },
    {
      id: 'dddd0004-0000-4000-8000-000000000000',
      kind: 'must_have',
      category: 'seniority',
      text: '7+ years required',
      sourceQuote: '7+ years of software experience',
      quoteVerified: true,
      confidence: 0.9,
      position: 3,
    },
    {
      id: 'dddd0005-0000-4000-8000-000000000000',
      kind: 'must_have',
      category: 'domain',
      text: 'Payments and fintech platform experience',
      sourceQuote: 'payments and fintech domain expertise',
      quoteVerified: true,
      confidence: 0.9,
      position: 4,
    },
    {
      id: 'dddd0006-0000-4000-8000-000000000000',
      kind: 'nice_to_have',
      category: 'other',
      text: 'Haskell curiosity',
      sourceQuote: 'Haskell a plus',
      quoteVerified: null,
      confidence: 0.5,
      position: 5,
    },
  ],
  runStatus: 'ok',
  profile: {
    skills: [
      {
        id: 'aaaa0001-0000-4000-8000-000000000001',
        name: 'TypeScript',
        category: 'language',
        level: 'expert',
        years: 8,
        lastUsed: '2026-07-01',
      },
      {
        id: 'aaaa0002-0000-4000-8000-000000000002',
        name: 'Node.js',
        category: 'runtime',
        level: 'solid',
        years: 7,
        lastUsed: '2026-07-01',
      },
      {
        id: 'aaaa0004-0000-4000-8000-000000000004',
        name: 'Kubernetes',
        category: 'infra',
        level: 'rusty',
        years: 2,
        lastUsed: '2024-01-01',
      },
    ],
    experiences: [
      {
        id: 'bbbb0001-0000-4000-8000-000000000001',
        company: 'Fictional Widgets Inc.',
        title: 'Software Engineer',
        startDate: '2015-07-18',
        endDate: '2019-07-18',
      },
      {
        id: 'bbbb0002-0000-4000-8000-000000000002',
        company: 'Fictional Gizmo Works',
        title: 'Senior Software Engineer',
        startDate: '2019-07-18',
        endDate: null,
      },
    ],
    projects: [
      {
        id: 'cccc0001-0000-4000-8000-000000000001',
        experienceId: 'bbbb0002-0000-4000-8000-000000000002',
        name: 'Payments Ledger Revamp',
        provenance: 'professional',
        summary: 'Event-driven payments and fintech pipeline rework',
      },
    ],
  },
  criteria: {
    hardFilters: {
      base_salary_max_is_known_and_below: 150_000,
      employment_type: ['contract'],
      seniority: ['intern', 'junior'],
      industry: ['gambling'],
    },
    positiveSignals: {
      role: ['senior'],
      technologies: ['node_js', 'postgresql', 'typescript', 'vue_3'],
      problem_domains: ['event_driven', 'payments_and_fintech'],
      work_arrangement: ['remote'],
      scope: ['platform'],
    },
    negativeSignals: ['gamedev_crunch', 'legacy_rescue'],
    forceLowestPriority: { industry: ['defense'] },
    compBounds: { currency: 'usd', base_preferred_min: 150_000, base_preferred_max: 190_000 },
  },
  referenceDate: '2026-07-18',
};

/** A permutation arbitrary for any array (identity when length <= 1). */
function permutationOf<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

const permutedInput: fc.Arbitrary<FitInput> = fc
  .record({
    requirements: permutationOf(BASE.requirements),
    skills: permutationOf(BASE.profile.skills),
    experiences: permutationOf(BASE.profile.experiences),
    projects: permutationOf(BASE.profile.projects),
    employmentType: permutationOf(BASE.criteria.hardFilters.employment_type!),
    filterSeniority: permutationOf(BASE.criteria.hardFilters.seniority!),
    filterIndustry: permutationOf(BASE.criteria.hardFilters.industry!),
    role: permutationOf(BASE.criteria.positiveSignals.role),
    technologies: permutationOf(BASE.criteria.positiveSignals.technologies),
    problemDomains: permutationOf(BASE.criteria.positiveSignals.problem_domains),
    workArrangement: permutationOf(BASE.criteria.positiveSignals.work_arrangement),
    scope: permutationOf(BASE.criteria.positiveSignals.scope),
    negativeSignals: permutationOf(BASE.criteria.negativeSignals),
    forcedIndustry: permutationOf(BASE.criteria.forceLowestPriority.industry),
  })
  .map((perm) => ({
    ...BASE,
    requirements: perm.requirements,
    profile: {
      skills: perm.skills,
      experiences: perm.experiences,
      projects: perm.projects,
    },
    criteria: {
      hardFilters: {
        ...BASE.criteria.hardFilters,
        employment_type: perm.employmentType,
        seniority: perm.filterSeniority,
        industry: perm.filterIndustry,
      },
      positiveSignals: {
        role: perm.role,
        technologies: perm.technologies,
        problem_domains: perm.problemDomains,
        work_arrangement: perm.workArrangement,
        scope: perm.scope,
      },
      negativeSignals: perm.negativeSignals,
      forceLowestPriority: { industry: perm.forcedIndustry },
      compBounds: BASE.criteria.compBounds,
    },
  }));

describe('scoreFit determinism (property)', () => {
  const baseline = scoreFit(BASE);

  it('repeated calls on the same input are deep-equal', () => {
    expect(scoreFit(BASE)).toEqual(baseline);
    expect(scoreFit(BASE)).toEqual(baseline);
  });

  it('permuting EVERY input array (requirements included) never changes the report', () => {
    fc.assert(
      fc.property(permutedInput, (permuted) => {
        expect(scoreFit(permuted)).toEqual(baseline);
      }),
      { seed: 20_260_718, numRuns: 100 },
    );
  });

  it('scoreFit never mutates its input', () => {
    const snapshot = structuredClone(BASE);
    scoreFit(BASE);
    expect(BASE).toEqual(snapshot);
  });
});

// M1-11: the classifier shares prepareInput, so it inherits the same
// property — same input SET, deep-equal assignments, no carve-outs.
describe('classifyGaps determinism (property)', () => {
  const baseline = classifyGaps(BASE);

  it('repeated calls on the same input are deep-equal', () => {
    expect(classifyGaps(BASE)).toEqual(baseline);
    expect(classifyGaps(BASE)).toEqual(baseline);
  });

  it('permuting EVERY input array (requirements included) never changes the assignments', () => {
    fc.assert(
      fc.property(permutedInput, (permuted) => {
        expect(classifyGaps(permuted)).toEqual(baseline);
      }),
      { seed: 20_260_718, numRuns: 100 },
    );
  });

  it('classifyGaps never mutates its input', () => {
    const snapshot = structuredClone(BASE);
    classifyGaps(BASE);
    expect(BASE).toEqual(snapshot);
  });
});
