import { describe, expect, it } from 'vitest';

import {
  buildTailoringPayload,
  validateTailoringSpec,
  type TailoringEvidenceInput,
  type TailoringGapInput,
  type TailoringSpecInput,
} from './tailoring-payload.ts';

// All fixture data is fictional (RISKS P-01) — the Alex Rivera persona.

const SKILLS = [
  { skillId: 'skill-ts', name: 'TypeScript', level: 'expert' as const },
  { skillId: 'skill-go', name: 'Go', level: 'solid' as const },
];
const EXPERIENCES = [
  { experienceId: 'exp-acme', company: 'Acme Analytics Co.', title: 'Senior Engineer' },
];
const PROJECTS = [
  {
    projectId: 'proj-dash',
    name: 'Reporting Dashboard',
    provenance: 'professional' as const,
    experienceId: 'exp-acme',
  },
];

function gapInput(overrides: Partial<TailoringGapInput> = {}): TailoringGapInput {
  return {
    gapId: 'gap-k8s',
    classification: 'genuine_gap',
    requirementId: 'req-k8s',
    requirementText: 'Kubernetes operations',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    rationale: 'No named-skill evidence.',
    ...overrides,
  };
}

function evidenceInput(overrides: Partial<TailoringEvidenceInput> = {}): TailoringEvidenceInput {
  return {
    requirementId: 'req-k8s',
    strength: 'adjacent',
    postingQuote: 'must run production Kubernetes',
    profileQuote: 'ran a fictional staging cluster',
    profileSkillId: null,
    profileProjectId: null,
    profileExperienceId: 'exp-acme',
    ...overrides,
  };
}

describe('buildTailoringPayload', () => {
  it('numbers each collection in order and maps refs to ids', () => {
    const built = buildTailoringPayload(SKILLS, EXPERIENCES, PROJECTS, [gapInput()], []);
    expect(built.entityCount).toBe(4);
    expect(built.gapCount).toBe(1);
    expect([...built.skillIdByRef.entries()]).toEqual([
      ['s1', 'skill-ts'],
      ['s2', 'skill-go'],
    ]);
    expect([...built.experienceIdByRef.entries()]).toEqual([['e1', 'exp-acme']]);
    expect([...built.projectIdByRef.entries()]).toEqual([['p1', 'proj-dash']]);
    expect([...built.gapIdByRef.entries()]).toEqual([['g1', 'gap-k8s']]);

    const parsed = JSON.parse(built.payload) as {
      skills: { ref: string }[];
      projects: { ref: string; experienceRef: string | null }[];
      gaps: { ref: string }[];
    };
    expect(parsed.skills.map((s) => s.ref)).toEqual(['s1', 's2']);
    // A project links its experience by ref, structurally.
    expect(parsed.projects[0]?.experienceRef).toBe('e1');
  });

  it('includes ALL gap classifications — a "have" gap is a strength to emphasize', () => {
    const built = buildTailoringPayload(
      SKILLS,
      EXPERIENCES,
      PROJECTS,
      [gapInput({ gapId: 'gap-have', classification: 'have', requirementText: 'STRENGTH-TS' })],
      [],
    );
    // Unlike drafting, the have-gap is present (the eligibility filter would be
    // wrong here).
    expect(built.gapCount).toBe(1);
    expect(built.payload).toContain('STRENGTH-TS');
    expect([...built.gapIdByRef.entries()]).toEqual([['g1', 'gap-have']]);
  });

  it('grounds evidence to the entity refs it links, and caps per gap at 3', () => {
    const built = buildTailoringPayload(
      SKILLS,
      EXPERIENCES,
      PROJECTS,
      [gapInput()],
      [
        evidenceInput({ postingQuote: 'q1' }),
        evidenceInput({
          postingQuote: 'q2',
          profileSkillId: 'skill-ts',
          profileExperienceId: null,
        }),
        evidenceInput({ postingQuote: 'q3' }),
        evidenceInput({ postingQuote: 'q4-over-cap' }),
      ],
    );
    const parsed = JSON.parse(built.payload) as {
      gaps: { evidence: { entities: string[] }[] }[];
    };
    const evidence = parsed.gaps[0]?.evidence ?? [];
    expect(evidence).toHaveLength(3);
    expect(built.payload).not.toContain('q4-over-cap');
    // First item links the experience (e1); second links the skill (s1).
    expect(evidence[0]?.entities).toEqual(['e1']);
    expect(evidence[1]?.entities).toEqual(['s1']);
  });

  it('drops an evidence entity ref that is not in the sent set (no dangling ref)', () => {
    const built = buildTailoringPayload(
      SKILLS,
      EXPERIENCES,
      PROJECTS,
      [gapInput()],
      [evidenceInput({ profileExperienceId: 'exp-unknown' })],
    );
    const parsed = JSON.parse(built.payload) as { gaps: { evidence: { entities: string[] }[] }[] };
    expect(parsed.gaps[0]?.evidence[0]?.entities).toEqual([]);
  });

  it('zero entities or zero gaps: the 409 signal', () => {
    expect(buildTailoringPayload([], [], [], [gapInput()], []).entityCount).toBe(0);
    expect(buildTailoringPayload(SKILLS, [], [], [], []).gapCount).toBe(0);
  });
});

describe('validateTailoringSpec', () => {
  const refs = buildTailoringPayload(SKILLS, EXPERIENCES, PROJECTS, [gapInput()], []);

  function spec(overrides: Partial<TailoringSpecInput> = {}): TailoringSpecInput {
    return {
      skillOrder: ['s2', 's1'],
      projectOrder: ['p1'],
      emphases: [{ entityRef: 's1', gapRefs: ['g1'], emphasis: 'lead', reason: 'why' }],
      ...overrides,
    };
  }

  it('maps a valid spec to ids: exact permutation orders + typed emphases', () => {
    const result = validateTailoringSpec(spec(), refs);
    expect(result.fabricatedRefCount).toBe(0);
    expect(result.missingRefCount).toBe(0);
    expect(result.spec).toBeDefined();
    // Reorder-only: the model put s2 first.
    expect(result.spec?.skillIdOrder).toEqual(['skill-go', 'skill-ts']);
    expect(result.spec?.projectIdOrder).toEqual(['proj-dash']);
    expect(result.spec?.emphases).toEqual([
      {
        entityType: 'skill',
        entityId: 'skill-ts',
        gapIds: ['gap-k8s'],
        emphasis: 'lead',
        reason: 'why',
      },
    ]);
  });

  it('an emphasis may target an experience ref (never ordered, but emphasizable)', () => {
    const result = validateTailoringSpec(
      spec({
        emphases: [{ entityRef: 'e1', gapRefs: ['g1'], emphasis: 'highlight', reason: 'r' }],
      }),
      refs,
    );
    expect(result.spec?.emphases[0]).toEqual({
      entityType: 'experience',
      entityId: 'exp-acme',
      gapIds: ['gap-k8s'],
      emphasis: 'highlight',
      reason: 'r',
    });
  });

  it('FLAGS a fabricated entity ref (never sent): spec undefined, count reported', () => {
    const result = validateTailoringSpec(
      spec({ emphases: [{ entityRef: 's9', gapRefs: ['g1'], emphasis: 'lead', reason: 'r' }] }),
      refs,
    );
    expect(result.spec).toBeUndefined();
    expect(result.fabricatedRefCount).toBe(1);
  });

  it('FLAGS a fabricated gap ref: spec undefined', () => {
    const result = validateTailoringSpec(
      spec({ emphases: [{ entityRef: 's1', gapRefs: ['g9'], emphasis: 'lead', reason: 'r' }] }),
      refs,
    );
    expect(result.spec).toBeUndefined();
    expect(result.fabricatedRefCount).toBe(1);
  });

  it('FLAGS a non-permutation order (a sent skill dropped): spec undefined, missing counted', () => {
    // s2 is omitted — dropping content is misrepresentation.
    const result = validateTailoringSpec(spec({ skillOrder: ['s1'] }), refs);
    expect(result.spec).toBeUndefined();
    expect(result.missingRefCount).toBe(1);
  });

  it('FLAGS an order ref that was never sent (fabricated in the order)', () => {
    const result = validateTailoringSpec(spec({ skillOrder: ['s1', 's2', 's3'] }), refs);
    expect(result.spec).toBeUndefined();
    expect(result.fabricatedRefCount).toBe(1);
  });
});
