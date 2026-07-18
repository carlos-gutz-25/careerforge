import {
  type FitInput,
  type FitReportData,
  type FitDimension,
  type ProfileResponse,
  type ScoringRequirement,
  type SearchCriteriaData,
  type SubScore,
} from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import { scoreFit } from './score-fit.ts';

// Table-driven engine tests (M1-09). ALL data fictional (RISKS P-01): the
// profile mirrors docs/profile.example vocabulary, figures are invented.
// Scores are hand-computed from the pinned formulas — the tests are the spec.

const REF = '2026-07-18';

const SKILLS = {
  typescript: {
    id: 'aaaa0001-0000-4000-8000-000000000001',
    name: 'TypeScript',
    category: 'language',
    level: 'expert',
    years: 8,
    lastUsed: '2026-07-01',
  },
  node: {
    id: 'aaaa0002-0000-4000-8000-000000000002',
    name: 'Node.js',
    category: 'runtime',
    level: 'solid',
    years: 7,
    lastUsed: '2026-07-01',
  },
  postgres: {
    id: 'aaaa0003-0000-4000-8000-000000000003',
    name: 'PostgreSQL',
    category: 'data',
    level: 'solid',
    years: 6,
    lastUsed: '2026-06-01',
  },
  kubernetes: {
    id: 'aaaa0004-0000-4000-8000-000000000004',
    name: 'Kubernetes',
    category: 'infra',
    level: 'rusty',
    years: 2,
    lastUsed: '2024-01-01',
  },
} as const satisfies Record<string, ProfileResponse['skills'][number]>;

const EXPERIENCES = {
  older: {
    id: 'bbbb0001-0000-4000-8000-000000000001',
    company: 'Fictional Widgets Inc.',
    title: 'Software Engineer',
    startDate: '2015-07-18',
    endDate: '2019-07-18',
  },
  current: {
    id: 'bbbb0002-0000-4000-8000-000000000002',
    company: 'Fictional Gizmo Works',
    title: 'Senior Software Engineer',
    startDate: '2019-07-18',
    endDate: null,
  },
} as const satisfies Record<string, ProfileResponse['experiences'][number]>;

const PROJECTS = {
  payments: {
    id: 'cccc0001-0000-4000-8000-000000000001',
    experienceId: 'bbbb0002-0000-4000-8000-000000000002',
    name: 'Payments Ledger Revamp',
    provenance: 'professional',
    summary: 'Event-driven payments and fintech pipeline rework',
  },
} as const satisfies Record<string, ProfileResponse['projects'][number]>;

const PROFILE: ProfileResponse = {
  skills: Object.values(SKILLS),
  experiences: Object.values(EXPERIENCES),
  projects: Object.values(PROJECTS),
};

const CRITERIA: SearchCriteriaData = {
  hardFilters: {
    base_salary_max_is_known_and_below: 150_000,
    compensation_type: 'equity_only',
    employment_type: ['contract'],
    seniority: ['intern', 'junior'],
    onsite_requirement: { without_relocation_support: true },
    primary_function: ['sales_engineering'],
    industry: ['gambling'],
  },
  positiveSignals: {
    role: ['senior'],
    technologies: ['node_js', 'postgresql', 'typescript', 'vue_3'],
    problem_domains: ['event_driven', 'payments_and_fintech'],
    work_arrangement: ['remote'],
    scope: ['platform'],
  },
  negativeSignals: ['gamedev_crunch'],
  forceLowestPriority: { industry: ['defense'] },
  compBounds: { currency: 'usd', base_preferred_min: 150_000, base_preferred_max: 190_000 },
};

let requirementSequence = 0;
function requirement(over: Partial<ScoringRequirement>): ScoringRequirement {
  requirementSequence += 1;
  return {
    id: `dddd${String(requirementSequence).padStart(4, '0')}-0000-4000-8000-000000000000`,
    kind: 'must_have',
    category: 'other',
    text: 'fictional requirement',
    sourceQuote: 'fictional quote',
    quoteVerified: true,
    confidence: 0.9,
    position: requirementSequence,
    ...over,
  };
}

function input(requirements: ScoringRequirement[], over: Partial<FitInput> = {}): FitInput {
  return {
    requirements,
    runStatus: 'ok',
    profile: PROFILE,
    criteria: CRITERIA,
    referenceDate: REF,
    ...over,
  };
}

function sub(report: FitReportData, dimension: FitDimension): SubScore {
  return report.subScores.find((entry) => entry.dimension === dimension)!;
}

// Recurring fixtures.
const tsReq = () =>
  requirement({
    kind: 'must_have',
    category: 'language',
    text: 'TypeScript expertise',
    sourceQuote: '5+ years of TypeScript',
  });
const vueReq = () =>
  requirement({
    kind: 'must_have',
    category: 'framework',
    text: 'Vue 3 frontend work',
    sourceQuote: 'experience with Vue 3',
  });
const k8sReq = () =>
  requirement({
    kind: 'nice_to_have',
    category: 'framework',
    text: 'Kubernetes deployments',
    sourceQuote: 'Kubernetes a plus',
  });

describe('scoreFit — scored happy path', () => {
  const report = scoreFit(input([tsReq(), vueReq(), k8sReq()]));

  it('verdict scored, no exclusions, all seven dimensions exactly once', () => {
    expect(report.verdict).toBe('scored');
    expect(report.exclusions).toEqual([]);
    expect(report.subScores.map((entry) => entry.dimension)).toEqual([
      'min_quals',
      'technical',
      'domain',
      'seniority',
      'comp_location',
      'priority',
      'stretch',
    ]);
    expect(report.unscoredRequirements).toEqual([]);
    expect(report.inputFlagged).toBe(false);
  });

  it('min_quals: 1 of 2 must_have rows covered -> 0.5, unmet named, direct evidence linked', () => {
    const minQuals = sub(report, 'min_quals');
    expect(minQuals.score).toBe(0.5);
    expect(minQuals.rationale).toContain('1 of 2 must-have requirement(s)');
    expect(minQuals.rationale).toContain('"Vue 3 frontend work"');
    expect(minQuals.evidence).toHaveLength(1);
    expect(minQuals.evidence[0]).toMatchObject({
      profileSkillId: SKILLS.typescript.id,
      strength: 'direct',
      postingQuote: '5+ years of TypeScript',
      profileQuote: 'TypeScript (expert, 8 yrs)',
    });
  });

  it('technical: coverage 0.5 blended with 2/4 matched technologies -> 0.5', () => {
    const technical = sub(report, 'technical');
    expect(technical.score).toBe(0.5);
    expect(technical.rationale).toContain('2 of 4 preferred technologies');
    expect(technical.rationale).toContain('typescript');
    expect(technical.rationale).toContain('vue_3');
  });

  it('domain and comp_location report their pre-registered neutrals', () => {
    expect(sub(report, 'domain').score).toBe(0.5);
    expect(sub(report, 'domain').rationale).toContain('No domain requirements extracted');
    expect(sub(report, 'comp_location').score).toBe(0.5);
    expect(sub(report, 'comp_location').rationale).toContain('no comp requirements extracted');
  });

  it('seniority: neutral without seniority requirements, span + reference date ALWAYS stated', () => {
    const seniority = sub(report, 'seniority');
    expect(seniority.score).toBe(0.5);
    expect(seniority.rationale).toContain('~11 years');
    expect(seniority.rationale).toContain(`as of ${REF}`);
  });

  it('priority: 2 of 9 positive signals -> 0.6111, no negatives, no forced-lowest', () => {
    const priority = sub(report, 'priority');
    expect(priority.score).toBe(0.6111);
    expect(priority.rationale).toContain('2 of 9 positive signals');
    expect(priority.rationale).toContain('no negative signals matched');
    expect(report.forcedLowestPriority).toEqual({ applied: false, matchedSlugs: [] });
  });

  it('stretch: the partially-covered nice-to-have is learnable-near -> 1', () => {
    const stretch = sub(report, 'stretch');
    expect(stretch.score).toBe(1);
    expect(stretch.rationale).toContain('"Kubernetes deployments"');
    expect(stretch.evidence[0]).toMatchObject({
      profileSkillId: SKILLS.kubernetes.id,
      strength: 'partial',
    });
  });
});

describe('scoreFit — pre-registered empty-input values (A6)', () => {
  it('an empty requirement set scores every dimension at its registered value', () => {
    const report = scoreFit(input([]));
    expect(report.verdict).toBe('scored');
    expect(report.exclusions).toEqual([]);
    expect(
      Object.fromEntries(report.subScores.map((entry) => [entry.dimension, entry.score])),
    ).toEqual({
      min_quals: 1, // vacuous
      technical: 0.5,
      domain: 0.5,
      seniority: 0.5,
      comp_location: 0.5,
      priority: 0.5, // zero matched signals
      stretch: 0, // nothing new = no stretch
    });
    expect(sub(report, 'min_quals').rationale).toContain('vacuously met');
    expect(sub(report, 'priority').rationale).toContain('0 of 9 positive signals');
  });

  it('an empty profile scores without crashing: no evidence, span 0, still deterministic', () => {
    const report = scoreFit(
      input([tsReq(), vueReq()], {
        profile: { skills: [], experiences: [], projects: [] },
      }),
    );
    expect(sub(report, 'min_quals').score).toBe(0);
    expect(sub(report, 'min_quals').evidence).toEqual([]);
    expect(sub(report, 'seniority').rationale).toContain('~0 years');
  });
});

describe('scoreFit — hard filters are explicit exclusion verdicts (AC edge)', () => {
  it('employment_type hit: verdict excluded with the quote, sub-scores still informative', () => {
    const contractReq = requirement({
      category: 'other',
      text: 'Contract engagement',
      sourceQuote: 'This is a 6-month contract position',
    });
    const report = scoreFit(input([tsReq(), contractReq]));
    expect(report.verdict).toBe('excluded');
    expect(report.exclusions).toEqual([
      {
        filterKey: 'employment_type',
        matchedValue: 'contract',
        postingQuote: 'This is a 6-month contract position',
      },
    ]);
    expect(report.subScores).toHaveLength(7);
    expect(sub(report, 'min_quals').score).toBeGreaterThan(0);
  });

  it('salary floor: parsed max below the floor fires AND the comp leg reads below-preferred', () => {
    const compReq = requirement({
      category: 'comp',
      text: 'Base salary stated',
      sourceQuote: 'Base salary $121,000 to $141,000',
    });
    const report = scoreFit(input([compReq]));
    expect(report.exclusions).toEqual([
      {
        filterKey: 'base_salary_max_is_known_and_below',
        matchedValue: '141000',
        postingQuote: 'Base salary $121,000 to $141,000',
      },
    ]);
    // comp leg 0 (entirely below preferred min), location leg neutral 0.5.
    expect(sub(report, 'comp_location').score).toBe(0.25);
    expect(sub(report, 'comp_location').rationale).toContain('121000-141000');
  });

  it('salary at/above the floor does NOT fire; comp leg reads within-preferred', () => {
    const compReq = requirement({
      category: 'comp',
      text: 'Base salary stated',
      sourceQuote: 'Base salary $151,000 to $171,000',
    });
    const report = scoreFit(input([compReq]));
    expect(report.verdict).toBe('scored');
    expect(report.exclusions).toEqual([]);
    expect(sub(report, 'comp_location').score).toBe(0.75);
  });

  it('unparseable compensation is UNKNOWN: never fires, comp leg neutral with the AC rationale', () => {
    const compReq = requirement({
      category: 'comp',
      text: 'Compensation discussed late in process',
      sourceQuote: 'competitive compensation and benefits',
    });
    const report = scoreFit(input([compReq]));
    expect(report.verdict).toBe('scored');
    expect(sub(report, 'comp_location').rationale).toContain(
      'no compensation information in the posting',
    );
  });

  it('equity_only fires on the adjacent phrase', () => {
    const equityReq = requirement({
      category: 'comp',
      text: 'Equity heavy package',
      sourceQuote: 'compensation is equity only until funding',
    });
    const report = scoreFit(input([equityReq]));
    expect(report.exclusions).toEqual([
      {
        filterKey: 'compensation_type',
        matchedValue: 'equity_only',
        postingQuote: 'compensation is equity only until funding',
      },
    ]);
  });

  it('seniority filter matches only seniority-category requirements', () => {
    const juniorReq = requirement({
      category: 'seniority',
      text: 'Junior engineer role',
      sourceQuote: 'hiring a junior engineer',
    });
    const report = scoreFit(input([juniorReq]));
    expect(report.exclusions).toEqual([
      { filterKey: 'seniority', matchedValue: 'junior', postingQuote: 'hiring a junior engineer' },
    ]);
    // The same token OUTSIDE the seniority category does not fire.
    const elsewhere = requirement({
      category: 'other',
      text: 'Mentor junior engineers',
      sourceQuote: 'mentor junior engineers',
    });
    expect(scoreFit(input([elsewhere])).exclusions).toEqual([]);
  });

  it('onsite_requirement NEVER fires automatically in v1 (documented narrowing)', () => {
    const onsiteReq = requirement({
      category: 'location',
      text: 'Onsite work required',
      sourceQuote: 'onsite in Fictional City, no relocation support',
    });
    const report = scoreFit(input([onsiteReq]));
    expect(report.verdict).toBe('scored');
    expect(report.exclusions).toEqual([]);
  });
});

describe('scoreFit — forceLowestPriority is a flag, never a clamp (D8/A3, AC edge)', () => {
  const defenseReq = () =>
    requirement({
      category: 'domain',
      text: 'Defense sector platform',
      sourceQuote: 'defense contractor environment',
    });

  it('matched industry sets the flag + one rationale sentence; every score stays honest', () => {
    const flagged = scoreFit(input([tsReq(), defenseReq()]));
    const unflagged = scoreFit(
      input([tsReq(), defenseReq()], {
        criteria: { ...CRITERIA, forceLowestPriority: { industry: ['space_mining_fictional'] } },
      }),
    );

    expect(flagged.verdict).toBe('scored'); // a cap, never an exclusion
    expect(flagged.forcedLowestPriority).toEqual({ applied: true, matchedSlugs: ['defense'] });
    expect(unflagged.forcedLowestPriority).toEqual({ applied: false, matchedSlugs: [] });

    // Flag never clamp: every sub-score identical with and without the match.
    expect(flagged.subScores.map((entry) => [entry.dimension, entry.score])).toEqual(
      unflagged.subScores.map((entry) => [entry.dimension, entry.score]),
    );
    expect(sub(flagged, 'priority').rationale).toContain('ranked to the bottom tier');
    expect(sub(flagged, 'priority').rationale).toContain('never excluded');
    expect(sub(unflagged, 'priority').rationale).not.toContain('bottom tier');
  });
});

describe('scoreFit — quoteVerified tristate (D3/A6)', () => {
  it('false AND NULL rows are scoring-ineligible with distinct reasons; they change no score and fire no filter', () => {
    const shared = tsReq(); // ONE instance: baseline evidence ids must match
    const failed = requirement({
      category: 'other',
      text: 'Contract engagement', // would fire employment_type if eligible
      sourceQuote: 'this is a contract position',
      quoteVerified: false,
    });
    const pending = requirement({
      category: 'language',
      text: 'PostgreSQL required', // would add coverage if eligible
      sourceQuote: 'PostgreSQL required',
      quoteVerified: null,
    });
    const withIneligible = scoreFit(input([shared, failed, pending], { runStatus: 'flagged' }));
    const baseline = scoreFit(input([shared]));

    expect(withIneligible.verdict).toBe('scored'); // the would-fire filter did not fire
    expect(withIneligible.exclusions).toEqual([]);
    expect(withIneligible.subScores).toEqual(baseline.subScores); // no numerator, no denominator
    expect(withIneligible.unscoredRequirements).toEqual([
      { requirementId: failed.id, reason: 'failed_verification' },
      { requirementId: pending.id, reason: 'not_yet_verified' },
    ]);
    expect(withIneligible.inputFlagged).toBe(true);
    expect(baseline.inputFlagged).toBe(false);
  });
});

describe('scoreFit — seniority (AC edge: mismatch)', () => {
  it('demanded years above the computed span score 0 with both figures stated', () => {
    const tooSenior = requirement({
      category: 'seniority',
      text: '15+ years required',
      sourceQuote: '15+ years of experience required',
    });
    const report = scoreFit(input([tooSenior]));
    const seniority = sub(report, 'seniority');
    expect(seniority.rationale).toContain('15+ years demanded');
    expect(seniority.rationale).toContain('falls short');
    expect(seniority.rationale).toContain(`as of ${REF}`);
    expect(seniority.evidence).toEqual([]);
  });

  it('demanded years within the span score 1 with experience-anchored evidence citing the reference date', () => {
    const senior = requirement({
      category: 'seniority',
      text: '7+ years required',
      sourceQuote: '7+ years of software experience',
    });
    const report = scoreFit(input([senior]));
    const seniority = sub(report, 'seniority');
    expect(seniority.evidence).toHaveLength(1);
    expect(seniority.evidence[0]).toMatchObject({
      profileExperienceId: EXPERIENCES.current.id,
      strength: 'adjacent',
    });
    expect(seniority.evidence[0]!.profileQuote).toContain(`as of ${REF}`);
  });
});

describe('scoreFit — domain bridge evidence + the domain law, live', () => {
  it('a payments/fintech DOMAIN requirement scores through project evidence and can NEVER exclude', () => {
    const paymentsReq = requirement({
      category: 'domain',
      text: 'Payments and fintech platform experience',
      sourceQuote: 'payments and fintech domain expertise',
    });
    const report = scoreFit(input([paymentsReq]));
    // Domain law, engine level: a scoring vocabulary cannot reach exclusion.
    expect(report.verdict).toBe('scored');
    expect(report.exclusions).toEqual([]);
    const domain = sub(report, 'domain');
    // coverage 0.25 (adjacent) blended with 1/2 matched problem domains.
    expect(domain.score).toBe(0.3);
    expect(domain.evidence[0]).toMatchObject({
      profileProjectId: PROJECTS.payments.id,
      profileSkillId: null,
      strength: 'adjacent',
    });
  });
});

describe('scoreFit — stretch branches (D4)', () => {
  it('partial coverage and unmatched-near both count; out-of-vocabulary does not', () => {
    const nearViaPartial = k8sReq(); // rusty skill -> partial 0.5
    const nearViaSignal = requirement({
      kind: 'nice_to_have',
      category: 'framework',
      text: 'Vue 3 dashboards',
      sourceQuote: 'Vue 3 a plus',
    }); // no evidence, but inside the vue_3 positive-signal domain
    const far = requirement({
      kind: 'nice_to_have',
      category: 'other',
      text: 'Haskell curiosity',
      sourceQuote: 'Haskell a plus',
    }); // no evidence, no signal
    const report = scoreFit(input([nearViaPartial, nearViaSignal, far]));
    const stretch = sub(report, 'stretch');
    expect(stretch.score).toBe(0.6667);
    expect(stretch.rationale).toContain('"Kubernetes deployments"');
    expect(stretch.rationale).toContain('"Vue 3 dashboards"');
    expect(stretch.rationale).not.toContain('"Haskell curiosity"');
  });
});
