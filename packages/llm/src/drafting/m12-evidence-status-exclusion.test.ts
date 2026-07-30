import { GAP_EVIDENCE_STATUS_CLASSIFICATIONS } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import { buildDraftingPayload, type DraftingGapInput } from './payload.ts';
import { buildLearningPayload, type LearningGapInput } from './learning-payload.ts';
import {
  buildInterviewPayload,
  type InterviewRequirementInput,
  type InterviewSkillInput,
} from './interview-payload.ts';
import {
  buildGameplanPayload,
  type GameplanRequirementInput,
  type GameplanSkillInput,
} from './gameplan-payload.ts';

// M12-02 arc R-2 leak guard. The three evidence-status classes
// (unknown / satisfied_fact / not_applicable) are NOT skill gaps and must NEVER
// reach ANY of the four LLM drafting payloads, so the drafting prompt vocabulary
// stays byte-stable (no prompt-version bump). This file proves, per builder:
//   (a) no serialized gapClassification value is an evidence-status string;
//   (b) a normal skill-gap class still survives (the builder was not emptied);
//   (c) byte-stability - the payload built WITH evidence-status gaps present is
//       IDENTICAL to the one built WITHOUT them (they change nothing the LLM sees).
//
// All fixture data is fictional (RISKS P-01): fictional companies, fictional
// skills, no real posting/person/employer.

// The three strings, as a plain readonly array for `.toContain` scans.
const EVIDENCE_STATUS: readonly string[] = GAP_EVIDENCE_STATUS_CLASSIFICATIONS;

/** Asserts none of the three evidence-status strings appears anywhere in the
 *  serialized payload (belt) and that the value set excludes them (braces). */
function expectNoEvidenceStatusLeak(payload: string, classificationValues: string[]): void {
  for (const status of EVIDENCE_STATUS) {
    expect(payload).not.toContain(status);
    expect(classificationValues).not.toContain(status);
  }
}

// --------------------------------------------------------------------------
// 1. buildDraftingPayload (improvement plans) - the gap IS the unit, so the
//    evidence-status gaps are added as extra gap rows and must be filtered out.
// --------------------------------------------------------------------------

function draftingGap(overrides: Partial<DraftingGapInput> = {}): DraftingGapInput {
  return {
    gapId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    classification: 'genuine_gap',
    requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    requirementText: 'Operate a fictional message bus at scale',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    rationale: 'No named-skill evidence links this requirement.',
    ...overrides,
  };
}

describe('buildDraftingPayload excludes the three evidence-status classes (arc R-2)', () => {
  // Two normal skill-gap gaps, interleaved with one gap of EACH evidence-status
  // class. If the filter were wrong, the evidence-status gaps would take ref
  // slots (shifting the normal gaps' refs) AND leak their class strings.
  const withEvidenceStatus: DraftingGapInput[] = [
    draftingGap({ gapId: 'es-unknown', classification: 'unknown', requirementId: 'req-unknown' }),
    draftingGap({
      gapId: 'normal-1',
      classification: 'genuine_gap',
      requirementId: 'req-normal-1',
      requirementText: 'Fictional Gizmo Works: run production Kubernetes',
    }),
    draftingGap({
      gapId: 'es-fact',
      classification: 'satisfied_fact',
      requirementId: 'req-fact',
    }),
    draftingGap({
      gapId: 'normal-2',
      classification: 'needs_refresh',
      requirementId: 'req-normal-2',
      requirementText: 'Fictional Gizmo Works: revive GraphQL federation',
    }),
    draftingGap({
      gapId: 'es-na',
      classification: 'not_applicable',
      requirementId: 'req-na',
    }),
  ];
  const withoutEvidenceStatus: DraftingGapInput[] = [
    draftingGap({
      gapId: 'normal-1',
      classification: 'genuine_gap',
      requirementId: 'req-normal-1',
      requirementText: 'Fictional Gizmo Works: run production Kubernetes',
    }),
    draftingGap({
      gapId: 'normal-2',
      classification: 'needs_refresh',
      requirementId: 'req-normal-2',
      requirementText: 'Fictional Gizmo Works: revive GraphQL federation',
    }),
  ];

  it('serializes no evidence-status class and keeps the normal skill-gap classes', () => {
    const built = buildDraftingPayload(
      [{ name: 'TypeScript', level: 'expert' }],
      withEvidenceStatus,
      [],
    );
    const parsed = JSON.parse(built.payload) as { gaps: { classification: string }[] };
    const classes = parsed.gaps.map((gap) => gap.classification);

    expectNoEvidenceStatusLeak(built.payload, classes);
    expect(classes).toContain('genuine_gap');
    expect(classes).toContain('needs_refresh');
    // Only the two skill-gap classes survive; refs number the eligible set.
    expect(built.eligibleGapCount).toBe(2);
    expect(classes).toHaveLength(2);
  });

  it('byte-stable: adding the evidence-status gaps changes nothing the LLM sees', () => {
    const withEs = buildDraftingPayload(
      [{ name: 'TypeScript', level: 'expert' }],
      withEvidenceStatus,
      [],
    );
    const withoutEs = buildDraftingPayload(
      [{ name: 'TypeScript', level: 'expert' }],
      withoutEvidenceStatus,
      [],
    );
    expect(withEs.payload).toBe(withoutEs.payload);
    expect([...withEs.gapIdByRef.entries()]).toEqual([...withoutEs.gapIdByRef.entries()]);
  });
});

// --------------------------------------------------------------------------
// 2. buildLearningPayload (learning plans) - gap IS the unit; refs are numbered
//    over the RANKED eligible set, so byte-stability also proves the excluded
//    gaps never perturb recurrence ranking.
// --------------------------------------------------------------------------

function learningGap(
  overrides: Partial<LearningGapInput> & Pick<LearningGapInput, 'gapId'>,
): LearningGapInput {
  return {
    classification: 'genuine_gap',
    requirementId: `req-${overrides.gapId}`,
    fitReportId: `report-${overrides.gapId}`,
    postingId: `posting-${overrides.gapId}`,
    requirementText: 'Some fictional requirement',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    rationale: 'no evidence',
    ...overrides,
  };
}

describe('buildLearningPayload excludes the three evidence-status classes (arc R-2)', () => {
  const SKILLS = [{ name: 'TypeScript', level: 'solid' as const }];

  const withEvidenceStatus: LearningGapInput[] = [
    learningGap({
      gapId: 'es-unknown',
      classification: 'unknown',
      requirementText: 'Unknown thing',
    }),
    learningGap({
      gapId: 'normal-1',
      classification: 'genuine_gap',
      requirementText: 'Operate Fictional Gizmo Works clusters',
      postingId: 'posting-A',
    }),
    learningGap({
      gapId: 'es-fact',
      classification: 'satisfied_fact',
      requirementText: 'Fact thing',
    }),
    learningGap({
      gapId: 'normal-2',
      classification: 'needs_refresh',
      requirementText: 'Refresh Fictional Gizmo Works pipelines',
      postingId: 'posting-B',
    }),
    learningGap({
      gapId: 'es-na',
      classification: 'not_applicable',
      requirementText: 'Not applicable thing',
    }),
  ];
  const withoutEvidenceStatus: LearningGapInput[] = [
    learningGap({
      gapId: 'normal-1',
      classification: 'genuine_gap',
      requirementText: 'Operate Fictional Gizmo Works clusters',
      postingId: 'posting-A',
    }),
    learningGap({
      gapId: 'normal-2',
      classification: 'needs_refresh',
      requirementText: 'Refresh Fictional Gizmo Works pipelines',
      postingId: 'posting-B',
    }),
  ];

  it('serializes no evidence-status class and keeps the normal skill-gap classes', () => {
    const built = buildLearningPayload(SKILLS, withEvidenceStatus, []);
    const parsed = JSON.parse(built.payload) as { gaps: { classification: string }[] };
    const classes = parsed.gaps.map((gap) => gap.classification);

    expectNoEvidenceStatusLeak(built.payload, classes);
    expect(classes).toContain('genuine_gap');
    expect(classes).toContain('needs_refresh');
    expect(built.eligibleGapCount).toBe(2);
    expect(classes).toHaveLength(2);
  });

  it('byte-stable: excluded gaps never take a ref slot nor perturb recurrence ranking', () => {
    const withEs = buildLearningPayload(SKILLS, withEvidenceStatus, []);
    const withoutEs = buildLearningPayload(SKILLS, withoutEvidenceStatus, []);
    expect(withEs.payload).toBe(withoutEs.payload);
    expect([...withEs.gapIdByRef.entries()]).toEqual([...withoutEs.gapIdByRef.entries()]);
  });
});

// --------------------------------------------------------------------------
// 3. buildInterviewPayload - the classification rides INLINE on a verified
//    requirement (requirement.gap.classification). "With vs without the
//    evidence-status gap" therefore toggles a requirement's .gap between an
//    evidence-status class and null; the requirement itself is unchanged, so the
//    payload is genuinely byte-identical (the requirement serializes the same,
//    just without a gapClassification field).
// --------------------------------------------------------------------------

const INTERVIEW_SKILLS: InterviewSkillInput[] = [{ name: 'TypeScript', level: 'expert' }];

function interviewRequirement(
  overrides: Partial<InterviewRequirementInput> & Pick<InterviewRequirementInput, 'requirementId'>,
): InterviewRequirementInput {
  return {
    quoteVerified: true,
    text: 'Build fictional TypeScript services',
    kind: 'must_have',
    category: 'framework',
    gap: null,
    ...overrides,
  };
}

describe('buildInterviewPayload drops evidence-status gap classes inline (arc R-2)', () => {
  // A normal-gap requirement (its gapClassification must appear) plus one
  // verified requirement per evidence-status class.
  const withEvidenceStatus: InterviewRequirementInput[] = [
    interviewRequirement({
      requirementId: 'req-normal',
      text: 'Fictional Gizmo Works: lead a TypeScript platform',
      gap: { gapId: 'gap-normal', classification: 'genuine_gap' },
    }),
    interviewRequirement({
      requirementId: 'req-unknown',
      text: 'Fictional Gizmo Works: evidence-status requirement A',
      gap: { gapId: 'gap-unknown', classification: 'unknown' },
    }),
    interviewRequirement({
      requirementId: 'req-fact',
      text: 'Fictional Gizmo Works: evidence-status requirement B',
      gap: { gapId: 'gap-fact', classification: 'satisfied_fact' },
    }),
    interviewRequirement({
      requirementId: 'req-na',
      text: 'Fictional Gizmo Works: evidence-status requirement C',
      gap: { gapId: 'gap-na', classification: 'not_applicable' },
    }),
  ];
  // Identical requirements, but the three evidence-status carriers hold NO gap
  // (null). A no-gap requirement and an evidence-status-gap requirement both
  // serialize without a gapClassification field, so these must be byte-equal.
  const withoutEvidenceStatus: InterviewRequirementInput[] = [
    interviewRequirement({
      requirementId: 'req-normal',
      text: 'Fictional Gizmo Works: lead a TypeScript platform',
      gap: { gapId: 'gap-normal', classification: 'genuine_gap' },
    }),
    interviewRequirement({
      requirementId: 'req-unknown',
      text: 'Fictional Gizmo Works: evidence-status requirement A',
      gap: null,
    }),
    interviewRequirement({
      requirementId: 'req-fact',
      text: 'Fictional Gizmo Works: evidence-status requirement B',
      gap: null,
    }),
    interviewRequirement({
      requirementId: 'req-na',
      text: 'Fictional Gizmo Works: evidence-status requirement C',
      gap: null,
    }),
  ];

  it('serializes no evidence-status class and keeps the normal skill-gap class', () => {
    const built = buildInterviewPayload(INTERVIEW_SKILLS, withEvidenceStatus, []);
    const parsed = JSON.parse(built.payload) as {
      requirements: { gapClassification?: string }[];
    };
    const classes = parsed.requirements
      .map((row) => row.gapClassification)
      .filter((value): value is string => value !== undefined);

    expectNoEvidenceStatusLeak(built.payload, classes);
    expect(classes).toContain('genuine_gap');
    // Only the normal requirement carries an inline classification.
    expect(classes).toEqual(['genuine_gap']);
    // The server-side resolution map is likewise clean: no evidence-status ref.
    for (const { classification } of built.gapByRequirementRef.values()) {
      expect(EVIDENCE_STATUS).not.toContain(classification);
    }
  });

  it('byte-stable: an evidence-status gap is indistinguishable from no gap', () => {
    const withEs = buildInterviewPayload(INTERVIEW_SKILLS, withEvidenceStatus, []);
    const withoutEs = buildInterviewPayload(INTERVIEW_SKILLS, withoutEvidenceStatus, []);
    expect(withEs.payload).toBe(withoutEs.payload);
    expect([...withEs.requirementIdByRef.entries()]).toEqual([
      ...withoutEs.requirementIdByRef.entries(),
    ]);
  });
});

// --------------------------------------------------------------------------
// 4. buildGameplanPayload - same inline-on-requirement idiom as interview
//    (gaps carry no refs). Toggle .gap between an evidence-status class and null.
// --------------------------------------------------------------------------

const GAMEPLAN_SKILLS: readonly GameplanSkillInput[] = [{ name: 'TypeScript', level: 'solid' }];

function gameplanRequirement(
  overrides: Partial<GameplanRequirementInput> & Pick<GameplanRequirementInput, 'requirementId'>,
): GameplanRequirementInput {
  return {
    quoteVerified: true,
    text: 'Build and operate fictional TypeScript services',
    kind: 'must_have',
    category: 'framework',
    gap: null,
    ...overrides,
  };
}

describe('buildGameplanPayload drops evidence-status gap classes inline (arc R-2)', () => {
  const withEvidenceStatus: GameplanRequirementInput[] = [
    gameplanRequirement({
      requirementId: 'req-normal',
      text: 'Fictional Gizmo Works: lead a TypeScript platform',
      gap: { gapId: 'gap-normal', classification: 'genuine_gap' },
    }),
    gameplanRequirement({
      requirementId: 'req-unknown',
      text: 'Fictional Gizmo Works: evidence-status requirement A',
      gap: { gapId: 'gap-unknown', classification: 'unknown' },
    }),
    gameplanRequirement({
      requirementId: 'req-fact',
      text: 'Fictional Gizmo Works: evidence-status requirement B',
      gap: { gapId: 'gap-fact', classification: 'satisfied_fact' },
    }),
    gameplanRequirement({
      requirementId: 'req-na',
      text: 'Fictional Gizmo Works: evidence-status requirement C',
      gap: { gapId: 'gap-na', classification: 'not_applicable' },
    }),
  ];
  const withoutEvidenceStatus: GameplanRequirementInput[] = [
    gameplanRequirement({
      requirementId: 'req-normal',
      text: 'Fictional Gizmo Works: lead a TypeScript platform',
      gap: { gapId: 'gap-normal', classification: 'genuine_gap' },
    }),
    gameplanRequirement({
      requirementId: 'req-unknown',
      text: 'Fictional Gizmo Works: evidence-status requirement A',
      gap: null,
    }),
    gameplanRequirement({
      requirementId: 'req-fact',
      text: 'Fictional Gizmo Works: evidence-status requirement B',
      gap: null,
    }),
    gameplanRequirement({
      requirementId: 'req-na',
      text: 'Fictional Gizmo Works: evidence-status requirement C',
      gap: null,
    }),
  ];

  it('serializes no evidence-status class and keeps the normal skill-gap class', () => {
    const built = buildGameplanPayload(GAMEPLAN_SKILLS, withEvidenceStatus, [], null);
    const parsed = JSON.parse(built.payload) as {
      requirements: { gapClassification?: string }[];
    };
    const classes = parsed.requirements
      .map((row) => row.gapClassification)
      .filter((value): value is string => value !== undefined);

    expectNoEvidenceStatusLeak(built.payload, classes);
    expect(classes).toContain('genuine_gap');
    expect(classes).toEqual(['genuine_gap']);
  });

  it('byte-stable: an evidence-status gap is indistinguishable from no gap', () => {
    const withEs = buildGameplanPayload(GAMEPLAN_SKILLS, withEvidenceStatus, [], null);
    const withoutEs = buildGameplanPayload(GAMEPLAN_SKILLS, withoutEvidenceStatus, [], null);
    expect(withEs.payload).toBe(withoutEs.payload);
    expect([...withEs.requirementIdByRef.entries()]).toEqual([
      ...withoutEs.requirementIdByRef.entries(),
    ]);
  });
});

// --------------------------------------------------------------------------
// M12-03: facts NEVER enter LLM drafting. A durable-fact evaluation always
// classifies as `satisfied_fact` or `unknown` (never `genuine_gap`), which the
// arc-R-2 filter above already drops from every builder - so declaring a fact
// can never change what a prompt sees. This is a NON-vacuous pin (real
// fact-shaped fixtures), naming the M12-03 guarantee explicitly rather than
// relying on the reader to connect it to the arc-R-2 classes.
// --------------------------------------------------------------------------
describe('M12-03: fact-derived gaps never reach the drafting payload', () => {
  it('a satisfied_fact / unknown gap from the durable_profile_fact evaluator is filtered out', () => {
    const built = buildDraftingPayload(
      [{ name: 'TypeScript', level: 'expert' }],
      [
        draftingGap({
          gapId: 'fact-satisfied',
          classification: 'satisfied_fact',
          requirementId: 'req-workauth',
          requirementText: 'Must be authorized to work in the US',
          rationale: 'Your declared work authorization matches the country this posting states.',
        }),
        draftingGap({
          gapId: 'fact-unknown',
          classification: 'unknown',
          requirementId: 'req-clearance',
          requirementText: 'Active security clearance required',
          rationale: 'This posting requires a security clearance; confirm it meets the level.',
        }),
        draftingGap({
          gapId: 'skill-gap',
          classification: 'genuine_gap',
          requirementId: 'req-skill',
          requirementText: 'Fictional Gizmo Works: run production Kubernetes',
        }),
      ],
      [],
    );
    const parsed = JSON.parse(built.payload) as { gaps: { classification: string }[] };
    const classes = parsed.gaps.map((gap) => gap.classification);
    expectNoEvidenceStatusLeak(built.payload, classes);
    // Only the genuine skill gap survives; the two fact-derived rows are gone.
    expect(classes).toEqual(['genuine_gap']);
    expect(built.eligibleGapCount).toBe(1);
  });
});
