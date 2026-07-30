import {
  type FitInput,
  type ProfileResponse,
  type ScoringRequirement,
  type SearchCriteriaData,
} from '@careerforge/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { classifyGaps, type ClassifierFact } from './classify-gaps.ts';

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

  describe('other + administrative phrase (M12-03: durable-fact route)', () => {
    // With NO declared facts (input() calls classifyGaps without a facts arg), a
    // MAPPED administrative requirement resolves to unknown via the
    // durable_profile_fact evaluator ("declare the fact to resolve"). It no
    // longer routes to administrative_pattern - that now covers only UNMAPPED
    // phrases (background check / drug screen) with no durable-fact model.
    it("'Must have work authorization' => unknown, durable_profile_fact", () => {
      const row = only(
        input([requirement({ category: 'other', text: 'Must have work authorization' })]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('durable_profile_fact');
      expect(row.confidence).toBe('low');
      expect(row.rationale).toContain('work authorization');
    });

    it("'Visa sponsorship not available' => unknown, durable_profile_fact (visa)", () => {
      const row = only(
        input([requirement({ category: 'other', text: 'Visa sponsorship not available' })]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('durable_profile_fact');
      expect(row.rationale).toContain('visa');
    });

    it("'Active security clearance required' => unknown, durable_profile_fact", () => {
      const row = only(
        input([requirement({ category: 'other', text: 'Active security clearance required' })]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('durable_profile_fact');
      expect(row.rationale).toContain('security clearance');
    });

    it("'authorization to work' variant also maps to the work_authorization fact", () => {
      // The M12-03 review (correctness#2): EVERY committed work-auth spelling maps
      // to the fact kind, including 'authorization to work'.
      const row = only(
        input([
          requirement({
            category: 'other',
            text: 'Must have authorization to work in the country',
          }),
        ]),
      );
      expect(row.classification).toBe('unknown');
      expect(row.evaluator).toBe('durable_profile_fact');
    });

    it('UNMAPPED admin phrases (background check / drug screen) stay administrative_pattern', () => {
      // No durable-fact model - honestly unmodeled, review manually.
      for (const text of [
        'Pre-employment background check required',
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

// -----------------------------------------------------------------------------
// M12-03: declared durable facts thread into classifyGaps as a PARALLEL arg and
// resolve administrative requirements. All fictional (RISKS P-01), ASCII-only.
describe('classifyGaps + declared facts (M12-03)', () => {
  const onlyFact = (requirements: ScoringRequirement[], facts: ClassifierFact[]) => {
    const rows = classifyGaps(input(requirements), facts);
    expect(rows).toHaveLength(1);
    const first = rows[0];
    if (!first) throw new Error('unreachable: length pinned above');
    return first;
  };

  it('work_authorization present + matching country requirement => satisfied_fact', () => {
    // Spelled-out country on both sides corroborates at high (bare "US"/"EU"
    // abbreviations are intentionally not country tokens - the pronoun-collision
    // code-review fix - and corroborate at medium instead).
    const row = onlyFact(
      [requirement({ category: 'other', text: 'Must be authorized to work in the United States' })],
      [{ kind: 'work_authorization', value: 'US citizen, authorized in the United States' }],
    );
    expect(row.classification).toBe('satisfied_fact');
    expect(row.evaluator).toBe('durable_profile_fact');
    expect(row.confidence).toBe('high');
  });

  it('work_authorization country CONFLICT (EU fact vs US posting) => unknown, never a false satisfy', () => {
    const row = onlyFact(
      [requirement({ category: 'other', text: 'Must be authorized to work in the United States' })],
      [{ kind: 'work_authorization', value: 'Authorized to work in the European Union only' }],
    );
    expect(row.classification).toBe('unknown');
    expect(row.evaluator).toBe('durable_profile_fact');
  });

  it('visa_sponsorship_needed=no => satisfied_fact even on a no-sponsorship posting', () => {
    const row = onlyFact(
      [requirement({ category: 'other', text: 'Visa sponsorship not available' })],
      [{ kind: 'visa_sponsorship_needed', value: 'no' }],
    );
    expect(row.classification).toBe('satisfied_fact');
    expect(row.evaluator).toBe('durable_profile_fact');
  });

  it('BLOCKER#1 GUARD: visa needed=yes + "sponsorship not available" => unknown (no silenced satisfy)', () => {
    // The affirmative-only detector must NOT swallow the negation - the repo's
    // own canonical fixture must stay unknown, not a hidden satisfied_fact.
    const row = onlyFact(
      [requirement({ category: 'other', text: 'Visa sponsorship not available' })],
      [{ kind: 'visa_sponsorship_needed', value: 'yes' }],
    );
    expect(row.classification).toBe('unknown');
    expect(row.evaluator).toBe('durable_profile_fact');
  });

  it('visa needed=yes + affirmative "sponsorship available" => satisfied_fact', () => {
    const row = onlyFact(
      [requirement({ category: 'other', text: 'Visa sponsorship available for this role' })],
      [{ kind: 'visa_sponsorship_needed', value: 'yes' }],
    );
    expect(row.classification).toBe('satisfied_fact');
    expect(row.evaluator).toBe('durable_profile_fact');
  });

  it('security_clearance is NEVER auto-satisfied (level comparison deferred)', () => {
    const row = onlyFact(
      [requirement({ category: 'other', text: 'Active security clearance required' })],
      [{ kind: 'security_clearance', value: 'Secret' }],
    );
    expect(row.classification).toBe('unknown');
    expect(row.evaluator).toBe('durable_profile_fact');
  });

  it('a location requirement rationale is enriched by relocation stance (never a gap)', () => {
    const row = onlyFact(
      [requirement({ category: 'location', text: 'Onsite in a fictional city' })],
      [{ kind: 'relocation_stance', value: 'open_for_right_opportunity' }],
    );
    expect(row.classification).toBe('not_applicable');
    expect(row.evaluator).toBe('dimension_delegation');
    expect(row.rationale).toContain('right role');
  });

  it('I3: a declared fact NEVER produces genuine_gap (facts inform, never gap)', () => {
    const phrases = [
      'Must have work authorization',
      'Visa sponsorship not available',
      'Active security clearance required',
      'Must be authorized to work in the US',
    ];
    const factSets: ClassifierFact[][] = [
      [],
      [{ kind: 'work_authorization', value: 'authorized in the EU only' }],
      [{ kind: 'visa_sponsorship_needed', value: 'yes' }],
      [{ kind: 'visa_sponsorship_needed', value: 'no' }],
      [{ kind: 'security_clearance', value: 'none' }],
    ];
    for (const text of phrases) {
      for (const facts of factSets) {
        for (const row of classifyGaps(input([requirement({ category: 'other', text })]), facts)) {
          expect(row.classification).not.toBe('genuine_gap');
        }
      }
    }
  });

  it('facts thread ONLY into classifyGaps, never onto the FitInput scoreFit reads', () => {
    // Structural D-4 guarantee: facts are a separate classifyGaps arg, so they
    // cannot reach scoreFit. Passing facts changes the gap classification only;
    // the FitInput object gains no `facts` key.
    const fitInput = input([
      requirement({ category: 'other', text: 'Must have work authorization' }),
    ]);
    const withoutFacts = classifyGaps(fitInput);
    const withFacts = classifyGaps(fitInput, [
      { kind: 'work_authorization', value: 'US, authorized to work in the US' },
    ]);
    expect(withoutFacts[0]!.classification).toBe('unknown'); // default-arg = pre-M12-03
    expect(withFacts[0]!.classification).toBe('satisfied_fact');
    expect('facts' in fitInput).toBe(false);
  });
});
