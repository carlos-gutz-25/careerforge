// M12-04 cross-system consistency fixture, SCORING layer. One coherent wholly
// fictional posting (10 requirements) + declared durable facts run through
// classifyGaps in a SINGLE call, pinning the full {classification, evaluator,
// confidence} triple per requirement plus the two arc invariants over this
// concrete input. The integration twin (apps/api/src/m12-04-consistency.routes
// .test.ts) drives the SAME fixture through the real HTTP surface; together they
// prove the taxonomy agrees whether you call the pure engine or the whole API.
//
// The per-CASE matrix + the fast-check invariants already live in
// classify-gaps.category-routing.test.ts; this file is deliberately the
// one-realistic-posting integration-of-the-classifier, not a re-run of that
// matrix. ALL data is FICTIONAL (RISKS P-01); ASCII-only (source-byte law:
// straight quotes and '-' only, no em-dash, no non-ASCII byte).
import {
  type FitInput,
  type GapClassification,
  type GapConfidence,
  type GapEvaluator,
  isEvidenceStatusClassification,
  type ProfileResponse,
  type ScoringRequirement,
  type SearchCriteriaData,
} from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import { classifyGaps, type ClassifierFact } from './classify-gaps.ts';

// A fixed reference date so the seniority span is deterministic (never the wall
// clock). The single long experience below gives a ~14-year span, comfortably
// above the demanded 5 years, so R1 is provably satisfied.
const REFERENCE_DATE = '2026-01-01';

const SKILLS: ProfileResponse['skills'] = [
  {
    id: 'aaaa0001-0000-4000-8000-000000000001',
    name: 'TypeScript',
    category: 'language',
    level: 'expert',
    years: 10,
    lastUsed: '2026-01-01',
  },
  {
    id: 'aaaa0002-0000-4000-8000-000000000002',
    name: 'Node.js',
    category: 'runtime',
    level: 'solid',
    years: 9,
    lastUsed: '2026-01-01',
  },
  {
    id: 'aaaa0003-0000-4000-8000-000000000003',
    name: 'React',
    category: 'framework',
    level: 'solid',
    years: 8,
    lastUsed: '2026-01-01',
  },
  {
    id: 'aaaa0004-0000-4000-8000-000000000004',
    name: 'PostgreSQL',
    category: 'database',
    level: 'solid',
    years: 8,
    lastUsed: '2026-01-01',
  },
  {
    // The D11 rung: a learning-level skill is not past competence, so a
    // must_have requirement naming it stays a genuine_gap to close.
    id: 'aaaa0005-0000-4000-8000-000000000005',
    name: 'Rust',
    category: 'language',
    level: 'learning',
    years: 0,
    lastUsed: null,
  },
];

const PROFILE: ProfileResponse = {
  skills: SKILLS,
  experiences: [
    {
      id: 'bbbb0001-0000-4000-8000-000000000001',
      company: 'Fictional Gizmo Works',
      title: 'Senior Software Engineer',
      startDate: '2012-01-01',
      endDate: null,
    },
  ],
  // No project mentions React, so R7 ("React and GraphQL") gets a DIRECT skill
  // link with no demonstration bridge => have_undemonstrated (rung 2). That is
  // the documented compound-requirement baseline: React evidence classifies the
  // whole compound; the unmet GraphQL is not separately surfaced (the
  // atomic-extraction arc will split this).
  projects: [],
};

const CRITERIA: SearchCriteriaData = {
  hardFilters: { employment_type: ['contract'] },
  positiveSignals: {
    role: ['senior'],
    technologies: ['typescript'],
    problem_domains: ['event_driven'],
    work_arrangement: ['remote'],
    scope: ['platform'],
  },
  negativeSignals: ['gamedev_crunch'],
  forceLowestPriority: { industry: ['defense'] },
  compBounds: { currency: 'usd', base_preferred_min: 150_000, base_preferred_max: 190_000 },
};

const FACTS: ClassifierFact[] = [
  { kind: 'work_authorization', value: 'US citizen, authorized to work in the United States' },
  { kind: 'visa_sponsorship_needed', value: 'no' },
  { kind: 'security_clearance', value: 'none' },
  { kind: 'relocation_stance', value: 'open_for_right_opportunity' },
  { kind: 'remote_onsite_stance', value: 'flexible' },
];

// The canonical fixture: ref -> requirement spec + expected verdict. Each ref
// keys a stable requirement id. sourceQuote strings are verbatim substrings of
// the fictional posting text mirrored in the integration twin.
type Expect = {
  classification: GapClassification;
  evaluator: GapEvaluator;
  confidence: GapConfidence | null;
  rationaleIncludes?: string;
};
type Case = {
  ref: string;
  requirement: Pick<ScoringRequirement, 'category' | 'text' | 'sourceQuote'> &
    Partial<ScoringRequirement>;
  expect: Expect;
};

const CASES: Case[] = [
  {
    ref: 'R1',
    requirement: {
      // Verbatim-identical to the integration twin's R1 (posting-verbatim string).
      category: 'seniority',
      text: 'minimum of 5 years of professional software engineering experience',
      sourceQuote: 'minimum of 5 years of professional software engineering experience',
    },
    expect: {
      classification: 'satisfied_fact',
      evaluator: 'seniority_threshold',
      confidence: 'high',
    },
  },
  {
    ref: 'R2',
    requirement: {
      category: 'other',
      text: 'Must be authorized to work in the United States',
      sourceQuote: 'Must be authorized to work in the United States',
    },
    expect: {
      classification: 'satisfied_fact',
      evaluator: 'durable_profile_fact',
      confidence: 'high',
    },
  },
  {
    ref: 'R3',
    requirement: {
      category: 'language',
      text: 'Production experience building services in Rust',
      sourceQuote: 'Production experience building services in Rust',
    },
    expect: { classification: 'genuine_gap', evaluator: 'skill_evidence', confidence: null },
  },
  {
    ref: 'R4',
    requirement: {
      category: 'language',
      text: 'Hands-on COBOL mainframe experience',
      sourceQuote: 'Hands-on COBOL mainframe experience',
    },
    expect: { classification: 'unknown', evaluator: 'skill_evidence', confidence: 'low' },
  },
  {
    ref: 'R5',
    requirement: {
      // Verbatim-identical to the integration twin's R5 (posting-verbatim string).
      category: 'comp',
      text: 'Base salary range of 150,000 to 180,000 USD',
      sourceQuote: 'Base salary range of 150,000 to 180,000 USD',
    },
    expect: {
      classification: 'not_applicable',
      evaluator: 'dimension_delegation',
      confidence: 'high',
    },
  },
  {
    ref: 'R6',
    requirement: {
      category: 'location',
      text: 'Onsite in Austin, Texas',
      sourceQuote: 'Onsite in Austin, Texas',
    },
    expect: {
      classification: 'not_applicable',
      evaluator: 'dimension_delegation',
      confidence: 'high',
      rationaleIncludes: 'right role',
    },
  },
  {
    ref: 'R7',
    requirement: {
      category: 'framework',
      text: 'Experience with React and GraphQL',
      sourceQuote: 'Experience with React and GraphQL',
    },
    // Compound baseline: React (solid, direct link, no bridge) => have_undemonstrated;
    // GraphQL absent but the compound classifies off React alone.
    expect: {
      classification: 'have_undemonstrated',
      evaluator: 'skill_evidence',
      confidence: null,
    },
  },
  {
    ref: 'R8',
    requirement: {
      category: 'other',
      text: 'Pre-employment background check required',
      sourceQuote: 'Pre-employment background check required',
    },
    expect: { classification: 'unknown', evaluator: 'administrative_pattern', confidence: 'low' },
  },
  {
    ref: 'R9',
    requirement: {
      category: 'other',
      text: 'No visa sponsorship is available for this role',
      sourceQuote: 'No visa sponsorship is available for this role',
    },
    expect: {
      classification: 'satisfied_fact',
      evaluator: 'durable_profile_fact',
      confidence: 'high',
    },
  },
  {
    ref: 'R10',
    requirement: {
      category: 'other',
      text: 'Active security clearance required',
      sourceQuote: 'Active security clearance required',
    },
    expect: { classification: 'unknown', evaluator: 'durable_profile_fact', confidence: 'low' },
  },
];

function requirementId(ref: string): string {
  // Deterministic v4-shaped id derived from the ref index (R1 -> ...0001).
  const n = String(CASES.findIndex((c) => c.ref === ref) + 1).padStart(4, '0');
  return `dddd${n}-0000-4000-8000-000000000000`;
}

function buildInput(): FitInput {
  const requirements: ScoringRequirement[] = CASES.map((c, index) => ({
    id: requirementId(c.ref),
    kind: 'must_have',
    quoteVerified: true,
    confidence: 0.9,
    position: index,
    ...c.requirement, // provides category, text, sourceQuote (+ any per-case overrides)
  }));
  return {
    requirements,
    runStatus: 'ok',
    profile: PROFILE,
    criteria: CRITERIA,
    referenceDate: REFERENCE_DATE,
  };
}

describe('M12-04 taxonomy consistency fixture (scoring layer)', () => {
  const assignments = classifyGaps(buildInput(), FACTS);
  const byId = new Map(assignments.map((a) => [a.requirementId, a]));

  it('classifies all 10 requirements exactly once', () => {
    expect(assignments).toHaveLength(CASES.length);
    for (const c of CASES) {
      expect(byId.has(requirementId(c.ref))).toBe(true);
    }
  });

  for (const c of CASES) {
    it(`${c.ref} => ${c.expect.classification} / ${c.expect.evaluator}`, () => {
      const row = byId.get(requirementId(c.ref));
      if (!row) throw new Error(`no assignment for ${c.ref}`);
      expect(row.classification).toBe(c.expect.classification);
      expect(row.evaluator).toBe(c.expect.evaluator);
      expect(row.confidence).toBe(c.expect.confidence);
      if (c.expect.rationaleIncludes) {
        expect(row.rationale).toContain(c.expect.rationaleIncludes);
      }
    });
  }

  // Invariant I1 restated over the concrete fixture: every requirement a
  // deterministic evaluator marks satisfied (the two satisfied_fact producers
  // + the seniority satisfy) is NEVER genuine_gap.
  it('I1: evaluator-satisfied requirements are never genuine_gap', () => {
    for (const c of CASES) {
      if (c.expect.classification === 'satisfied_fact') {
        expect(byId.get(requirementId(c.ref))?.classification).not.toBe('genuine_gap');
      }
    }
  });

  // Invariant I2 restated: the no-evidence, no-positive-signal skill requirement
  // (R4) falls through to unknown, never genuine_gap.
  it('I2: the no-signal skill requirement is unknown, never genuine_gap', () => {
    const r4 = byId.get(requirementId('R4'));
    expect(r4?.classification).toBe('unknown');
    expect(r4?.classification).not.toBe('genuine_gap');
  });

  // The suppression contract driven off ENGINE OUTPUT (not the fixture's own
  // expected labels): the three evidence-status classes classifyGaps actually
  // produced are exactly the set the four drafting payload builders suppress.
  it('the evidence-status predicate partitions the ENGINE OUTPUT as the downstream builders will', () => {
    const refOf = (id: string): string =>
      CASES.find((c) => requirementId(c.ref) === id)?.ref ?? '?';
    const suppressed = assignments
      .filter((a) => isEvidenceStatusClassification(a.classification))
      .map((a) => refOf(a.requirementId))
      .sort();
    const flowThrough = assignments
      .filter((a) => !isEvidenceStatusClassification(a.classification))
      .map((a) => refOf(a.requirementId))
      .sort();
    expect(suppressed).toEqual(['R1', 'R2', 'R4', 'R5', 'R6', 'R8', 'R9', 'R10'].sort());
    expect(flowThrough).toEqual(['R3', 'R7'].sort());
    // R1 (satisfied_fact) is suppressed despite being a "satisfy"; only R3
    // (genuine_gap) and R7 (have_undemonstrated) reach the drafting payloads.
  });
});
