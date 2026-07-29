import {
  type FitInput,
  type ProfileResponse,
  type ScoringRequirement,
  type SearchCriteriaData,
} from '@careerforge/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { classifyGaps } from './classify-gaps.ts';

// The HEADLINE test of the M12-02 arc: the CATEGORY ROUTING matrix and the two
// safety INVARIANTS. classifyRequirement routes on requirement.category BEFORE
// the skill ladder, so this file pins, per category, which deterministic
// evaluator fires and what it returns. ALL data is FICTIONAL (RISKS P-01) and
// this file is ASCII-only (source-byte law: straight quotes and '-' only).
//
// requirement() defaults category:'other', so every routing case passes its
// category EXPLICITLY. The exact evaluator/confidence/classification values are
// READ from classify-gaps.ts + evaluators/seniority-threshold.ts, never guessed.

const SKILLS = {
  typescript: {
    id: 'aaaa0001-0000-4000-8000-000000000001',
    name: 'TypeScript',
    category: 'language',
    level: 'expert',
    years: 8,
    lastUsed: '2026-07-01',
  },
  kubernetes: {
    id: 'aaaa0004-0000-4000-8000-000000000004',
    name: 'Kubernetes',
    category: 'infra',
    level: 'rusty',
    years: 2,
    lastUsed: '2024-01-01',
  },
  rust: {
    id: 'aaaa0005-0000-4000-8000-000000000005',
    name: 'Rust',
    category: 'language',
    level: 'learning',
    years: 0,
    lastUsed: '2026-07-01',
  },
} as const satisfies Record<string, ProfileResponse['skills'][number]>;

// One long-tenure experience gives a professional span comfortably >= 15 years
// as of the fixed reference date below (2008-01-01 -> open interval closed at
// 2026-07-18 ~= 18.5 years). That makes every seniority "N+ years" demand with
// N <= 15 provably satisfied, which invariant I1 relies on.
const PROFILE: ProfileResponse = {
  skills: Object.values(SKILLS),
  experiences: [
    {
      id: 'bbbb0002-0000-4000-8000-000000000002',
      company: 'Fictional Gizmo Works',
      title: 'Senior Software Engineer',
      startDate: '2008-01-01',
      endDate: null,
    },
  ],
  projects: [
    {
      id: 'cccc0001-0000-4000-8000-000000000001',
      experienceId: 'bbbb0002-0000-4000-8000-000000000002',
      name: 'Payments Ledger Revamp',
      provenance: 'professional',
      summary: 'Event-driven payments and fintech pipeline rework in TypeScript',
    },
  ],
};

const CRITERIA: SearchCriteriaData = {
  hardFilters: {
    base_salary_max_is_known_and_below: 150_000,
    employment_type: ['contract'],
    seniority: ['intern', 'junior'],
    industry: ['gambling'],
  },
  positiveSignals: {
    role: ['senior'],
    technologies: ['typescript', 'vue_3'],
    problem_domains: ['event_driven', 'payments_and_fintech'],
    work_arrangement: ['remote'],
    scope: ['platform'],
  },
  negativeSignals: ['gamedev_crunch'],
  forceLowestPriority: { industry: ['defense'] },
  compBounds: { currency: 'usd', base_preferred_min: 150_000, base_preferred_max: 190_000 },
};

let sequence = 0;
function requirement(over: Partial<ScoringRequirement>): ScoringRequirement {
  sequence += 1;
  return {
    id: `dddd${String(sequence).padStart(4, '0')}-0000-4000-8000-000000000000`,
    kind: 'must_have',
    category: 'other',
    text: 'fictional requirement',
    sourceQuote: 'fictional quote',
    quoteVerified: true,
    confidence: 0.9,
    position: sequence,
    ...over,
  };
}

function input(requirements: ScoringRequirement[], over: Partial<FitInput> = {}): FitInput {
  return {
    requirements,
    runStatus: 'ok',
    profile: PROFILE,
    criteria: CRITERIA,
    referenceDate: '2026-07-18',
    ...over,
  };
}

function only(fitInput: FitInput) {
  const assignments = classifyGaps(fitInput);
  expect(assignments).toHaveLength(1);
  const first = assignments[0];
  if (!first) throw new Error('unreachable: length pinned above');
  return first;
}

describe('classifyGaps category routing matrix (M12-02 headline)', () => {
  describe('seniority -> seniority_threshold', () => {
    it("'5+ years' demanded and span >= 5 => satisfied_fact, high", () => {
      const row = only(
        input([
          requirement({ category: 'seniority', text: '5+ years of professional experience' }),
        ]),
      );
      expect(row.classification).toBe('satisfied_fact');
      expect(row.evaluator).toBe('seniority_threshold');
      expect(row.confidence).toBe('high');
    });

    it("'10+ years' demanded and a smaller span => genuine_gap, high", () => {
      // A short-tenure profile variant: one experience 2023-01-01 -> open,
      // closed at 2026-07-18 (~3.5 years span), so 10+ is NOT met.
      const shortSpan: ProfileResponse = {
        ...PROFILE,
        experiences: [
          {
            id: 'bbbb0003-0000-4000-8000-000000000003',
            company: 'Fictional Gizmo Works',
            title: 'Software Engineer',
            startDate: '2023-01-01',
            endDate: null,
          },
        ],
      };
      const row = only(
        input(
          [requirement({ category: 'seniority', text: '10+ years of engineering leadership' })],
          { profile: shortSpan },
        ),
      );
      expect(row.classification).toBe('genuine_gap');
      expect(row.evaluator).toBe('seniority_threshold');
      expect(row.confidence).toBe('high');
    });

    it('no years figure => unknown, seniority_threshold (nothing to compare)', () => {
      const row = only(
        input([
          requirement({ category: 'seniority', text: 'Senior technical leadership across teams' }),
        ]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('seniority_threshold');
      expect(row.confidence).toBe('low');
    });
  });

  describe('comp / location -> dimension_delegation', () => {
    it('comp => not_applicable, dimension_delegation, high', () => {
      const row = only(input([requirement({ category: 'comp', text: 'Base salary 200k and up' })]));
      expect(row.classification).toBe('not_applicable');
      expect(row.evaluator).toBe('dimension_delegation');
      expect(row.confidence).toBe('high');
    });

    it('location => not_applicable, dimension_delegation', () => {
      const row = only(
        input([
          requirement({ category: 'location', text: 'Onsite in a fictional city, no remote' }),
        ]),
      );
      expect(row.classification).toBe('not_applicable');
      expect(row.evaluator).toBe('dimension_delegation');
    });
  });

  describe('other + administrative phrase -> administrative_pattern', () => {
    it("'Must have work authorization' => unknown, administrative_pattern", () => {
      const row = only(
        input([requirement({ category: 'other', text: 'Must have work authorization' })]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('administrative_pattern');
      expect(row.confidence).toBe('low');
      expect(row.rationale).toContain('work authorization');
    });

    it("'Visa sponsorship not available' => unknown, administrative_pattern (visa)", () => {
      const row = only(
        input([requirement({ category: 'other', text: 'Visa sponsorship not available' })]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('administrative_pattern');
      expect(row.rationale).toContain('visa');
    });

    it("'Active security clearance required' => unknown, administrative_pattern", () => {
      const row = only(
        input([requirement({ category: 'other', text: 'Active security clearance required' })]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('administrative_pattern');
      expect(row.rationale).toContain('security clearance');
    });

    it('common phrasing variants also route administrative (M12-02 panel finding)', () => {
      // Variants of already-covered concepts: "authorization to work" (vs
      // "work authorization"/"authorized to work") and the gerund drug forms.
      for (const text of [
        'Must have authorization to work in the country',
        'Pre-employment drug screening required',
        'Subject to a drug testing policy',
      ]) {
        const row = only(input([requirement({ category: 'other', text })]));
        expect(row.classification).toBe('unknown');
        expect(row.evaluator).toBe('administrative_pattern');
      }
    });

    it("NEGATIVE: 'data visualization' must NOT fire 'visa' (token-level, not substring)", () => {
      // 'visualization' contains the substring 'visa' but is a different TOKEN,
      // so the administrative matcher must not fire; the requirement ladders as
      // skill_evidence instead.
      const row = only(
        input([requirement({ category: 'other', text: 'Data visualization dashboards' })]),
      );
      expect(row.evaluator).toBe('skill_evidence');
      expect(row.evaluator).not.toBe('administrative_pattern');
    });
  });

  describe('skill category (language/framework/domain) -> skill_evidence ladder', () => {
    it("'have' spot-check: named direct skill + project demonstration", () => {
      // Direct link (TypeScript expert named) + adjacent bridge (slug
      // 'typescript' on the requirement AND the project summary).
      const row = only(
        input([requirement({ category: 'language', text: 'TypeScript platform work' })]),
      );
      expect(row.classification).toBe('have');
      expect(row.evaluator).toBe('skill_evidence');
    });

    it("'unknown' fall-through spot-check: no signal on a skill-category requirement", () => {
      const row = only(
        input([requirement({ category: 'domain', text: 'Embedded firmware background' })]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('skill_evidence');
      expect(row.confidence).toBe('low');
    });
  });
});

// -----------------------------------------------------------------------------
// The two safety INVARIANTS (property-style, fast-check). The profile is FIXED
// and fictional; only the generated requirement text varies. Generators are
// bounded so each invariant is actually EXERCISED (never vacuous): I1 bounds the
// demanded years to <= the span, I2 uses distinctive prefixed tokens that cannot
// collide with the fixed profile vocabulary.

// A token that cannot appear in the fixed profile/criteria vocabulary: a 'zzq'
// prefix plus a base-36 rendering of a positive integer. base-36 is [0-9a-z]
// only (no split by tokenizeForMatching), and no fixture skill/project/criteria
// slug starts with 'zzq', so these share NO token with the profile.
const distinctiveToken: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 1_000_000_000 })
  .map((n) => `zzq${n.toString(36)}`);

describe('classifyGaps safety invariants (M12-02 property)', () => {
  it('I1: a satisfied seniority threshold NEVER emits genuine_gap', () => {
    // Demanded years bounded to [1, 15] <= the fixed ~18.5-year span, so the
    // threshold is always satisfied. The invariant: it classifies satisfied_fact
    // and can never be genuine_gap for a met threshold.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), (years) => {
        const row = only(
          input([
            requirement({
              category: 'seniority',
              text: `${String(years)}+ years of professional experience`,
            }),
          ]),
        );
        expect(row.evaluator).toBe('seniority_threshold');
        expect(row.classification).not.toBe('genuine_gap');
        expect(row.classification).toBe('satisfied_fact');
      }),
      { seed: 20_260_729, numRuns: 200 },
    );
  });

  it('I2: no evidence and no positive signal => unknown, NEVER genuine_gap', () => {
    // A skill-category requirement whose text shares no token with any profile
    // skill/project, is must_have (not nice_to_have), and matches no negative
    // signal must fall through to unknown (insufficient evidence), never a
    // confirmed gap.
    const skillCategory = fc.constantFrom(
      'language' as const,
      'framework' as const,
      'domain' as const,
    );
    fc.assert(
      fc.property(
        skillCategory,
        fc.array(distinctiveToken, { minLength: 2, maxLength: 5 }),
        (category, tokens) => {
          const row = only(
            input([requirement({ category, kind: 'must_have', text: tokens.join(' ') })]),
          );
          expect(row.evaluator).toBe('skill_evidence');
          expect(row.classification).not.toBe('genuine_gap');
          expect(row.classification).toBe('unknown');
        },
      ),
      { seed: 20_260_729, numRuns: 200 },
    );
  });
});
