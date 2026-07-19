import {
  type FitInput,
  type ProfileResponse,
  type ScoringRequirement,
  type SearchCriteriaData,
} from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import { classifyGaps } from './classify-gaps.ts';

// Table-driven classifier tests (M1-11). ALL data fictional (RISKS P-01).
// The ladder order is the spec; every rung and every pre-registered
// precedence collision is pinned here, each fixture's label stating its
// FULL link set (plan rider R5).

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

const PROFILE: ProfileResponse = {
  skills: Object.values(SKILLS),
  experiences: [
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

describe('classifyGaps ladder', () => {
  it('have — direct link + project demonstration (typescript bridges to the project)', () => {
    // Link set: direct (TypeScript expert) + adjacent project (bridge slug
    // `typescript` appears in requirement AND project summary).
    const row = only(
      input([requirement({ text: 'TypeScript platform work', category: 'language' })]),
    );
    expect(row.classification).toBe('have');
    expect(row.rationale).toContain('TypeScript (expert, 8 yrs)');
    expect(row.rationale).toContain('Payments Ledger Revamp');
  });

  it('have_undemonstrated — direct link only, no project/experience link', () => {
    // Link set: direct (TypeScript expert) only. Profile variant whose
    // project summary does NOT mention typescript, so no bridge slug lands
    // on both sides and no adjacent link can form.
    const profile: ProfileResponse = {
      ...PROFILE,
      projects: [
        {
          id: 'cccc0002-0000-4000-8000-000000000002',
          experienceId: null,
          name: 'Home Automation Hub',
          provenance: 'personal',
          summary: 'Sensor dashboard for a fictional house',
        },
      ],
    };
    const row = only(
      input([requirement({ text: 'TypeScript expertise required', category: 'language' })], {
        profile,
      }),
    );
    expect(row.classification).toBe('have_undemonstrated');
    expect(row.rationale).toContain('TypeScript (expert, 8 yrs)');
    expect(row.rationale).toContain('no project or experience demonstrates it');
  });

  it('needs_refresh — rusty-partial link only', () => {
    // Link set: partial (Kubernetes rusty); kubernetes is not a criteria
    // slug, so no bridge link exists.
    const row = only(input([requirement({ text: 'Kubernetes cluster operations' })]));
    expect(row.classification).toBe('needs_refresh');
    expect(row.rationale).toContain('Kubernetes (rusty, 2 yrs)');
  });

  it('low_priority — nice_to_have with zero links', () => {
    // Link set: none; kind nice_to_have.
    const row = only(input([requirement({ text: 'Haskell curiosity', kind: 'nice_to_have' })]));
    expect(row.classification).toBe('low_priority');
    expect(row.rationale).toContain('nice-to-have');
  });

  it('low_priority — must_have matching a negative signal, zero links', () => {
    // Link set: none; must_have; text matches negativeSignals slug
    // gamedev_crunch.
    const row = only(input([requirement({ text: 'Thrives in gamedev crunch culture' })]));
    expect(row.classification).toBe('low_priority');
    expect(row.rationale).toContain('gamedev_crunch');
  });

  it('genuine_gap — zero links, must_have, no negative signal', () => {
    // Link set: none.
    const row = only(input([requirement({ text: 'Embedded firmware background' })]));
    expect(row.classification).toBe('genuine_gap');
    expect(row.rationale).toBe('No named-skill evidence.');
  });

  it('genuine_gap — adjacent-only evidence never claims having (D10), and is named as mitigation', () => {
    // Link set: adjacent project only (bridge slug event_driven on both
    // sides; no named skill matches).
    const row = only(input([requirement({ text: 'Event driven architecture design' })]));
    expect(row.classification).toBe('genuine_gap');
    expect(row.rationale).toContain('Adjacent evidence exists');
    expect(row.rationale).toContain('Payments Ledger Revamp');
  });

  it('genuine_gap — learning-partial is not a refresh (D11), and is named as mitigation', () => {
    // Link set: partial (Rust learning) only.
    const row = only(input([requirement({ text: 'Rust services in production' })]));
    expect(row.classification).toBe('genuine_gap');
    expect(row.rationale).toContain('In-progress skill (Rust (learning, 0 yrs))');
  });
});

describe('classifyGaps precedence collisions (R5: full link set declared)', () => {
  it('direct+demonstrated+negative-signal => have (rung 1 outranks low_priority)', () => {
    const row = only(
      input([
        requirement({ text: 'TypeScript platform under gamedev crunch', category: 'language' }),
      ]),
    );
    expect(row.classification).toBe('have');
  });

  it('nice_to_have+direct+demonstrated => have (kind never demotes a have)', () => {
    const row = only(
      input([
        requirement({
          text: 'TypeScript platform work',
          kind: 'nice_to_have',
          category: 'language',
        }),
      ]),
    );
    expect(row.classification).toBe('have');
  });

  it('nice_to_have+direct, no project/experience link => have_undemonstrated', () => {
    const profile: ProfileResponse = {
      ...PROFILE,
      projects: [],
    };
    const row = only(
      input([requirement({ text: 'TypeScript expertise', kind: 'nice_to_have' })], { profile }),
    );
    expect(row.classification).toBe('have_undemonstrated');
  });

  it('rusty-partial+nice_to_have => needs_refresh (rung 3 outranks low_priority)', () => {
    const row = only(
      input([requirement({ text: 'Kubernetes deployments a plus', kind: 'nice_to_have' })]),
    );
    expect(row.classification).toBe('needs_refresh');
  });

  it('nice_to_have with adjacent-only evidence => low_priority, mitigation named (R4 parity)', () => {
    const row = only(
      input([requirement({ text: 'Event driven architecture a plus', kind: 'nice_to_have' })]),
    );
    expect(row.classification).toBe('low_priority');
    expect(row.rationale).toContain('Adjacent evidence exists');
    expect(row.rationale).toContain('Payments Ledger Revamp');
  });

  it('nice_to_have with learning-partial => low_priority, in-progress skill named (R4 parity)', () => {
    const row = only(
      input([requirement({ text: 'Rust curiosity welcome', kind: 'nice_to_have' })]),
    );
    expect(row.classification).toBe('low_priority');
    expect(row.rationale).toContain('In-progress skill (Rust (learning, 0 yrs))');
  });
});

describe('classifyGaps pre-registrations (A6 pattern)', () => {
  it('zero eligible requirements => zero assignments, no throw', () => {
    expect(classifyGaps(input([]))).toEqual([]);
    expect(
      classifyGaps(
        input([requirement({ quoteVerified: false }), requirement({ quoteVerified: null })]),
      ),
    ).toEqual([]);
  });

  it('unscored rows produce NO assignment even among eligible ones', () => {
    const eligible = requirement({ text: 'TypeScript platform work' });
    const failed = requirement({ text: 'Kubernetes cluster operations', quoteVerified: false });
    const assignments = classifyGaps(input([eligible, failed]));
    expect(assignments.map((a) => a.requirementId)).toEqual([eligible.id]);
  });

  it('empty profile => only genuine_gap or low_priority can fire', () => {
    const profile: ProfileResponse = { skills: [], experiences: [], projects: [] };
    const assignments = classifyGaps(
      input(
        [
          requirement({ text: 'TypeScript platform work' }),
          requirement({ text: 'Haskell curiosity', kind: 'nice_to_have' }),
          requirement({ text: 'Kubernetes cluster operations' }),
        ],
        { profile },
      ),
    );
    expect(assignments.map((a) => a.classification)).toEqual([
      'genuine_gap',
      'low_priority',
      'genuine_gap',
    ]);
  });

  it('output rides canonical (position, id) order regardless of input order', () => {
    const first = requirement({ text: 'TypeScript platform work', position: 1 });
    const second = requirement({ text: 'Kubernetes cluster operations', position: 2 });
    const assignments = classifyGaps(input([second, first]));
    expect(assignments.map((a) => a.requirementId)).toEqual([first.id, second.id]);
  });

  it('classifyGaps never mutates its input', () => {
    const fitInput = input([requirement({ text: 'TypeScript platform work' })]);
    const snapshot = structuredClone(fitInput);
    classifyGaps(fitInput);
    expect(fitInput).toEqual(snapshot);
  });
});
