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
  {
    experienceId: 'exp-acme',
    company: 'Acme Analytics Co.',
    title: 'Senior Engineer',
    bullets: [
      { bulletId: 'b-led', text: 'Led a fictional migration.' },
      { bulletId: 'b-cut', text: 'Cut fictional latency.' },
    ],
  },
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

  it('numbers experience bullets with per-experience refs and maps them to ids (M2-12)', () => {
    const built = buildTailoringPayload(SKILLS, EXPERIENCES, PROJECTS, [gapInput()], []);
    expect([...built.bulletIdByRef.entries()]).toEqual([
      ['e1b1', 'b-led'],
      ['e1b2', 'b-cut'],
    ]);
    const parsed = JSON.parse(built.payload) as {
      experiences: { ref: string; bullets: { ref: string; text: string }[] }[];
    };
    expect(parsed.experiences[0]?.bullets).toEqual([
      { ref: 'e1b1', text: 'Led a fictional migration.' },
      { ref: 'e1b2', text: 'Cut fictional latency.' },
    ]);
  });

  it('an experience with no bullets serializes an empty bullets array', () => {
    const built = buildTailoringPayload(
      SKILLS,
      [{ experienceId: 'exp-bare', company: 'Bare Co.', title: 'Engineer' }],
      [],
      [gapInput()],
      [],
    );
    expect(built.bulletIdByRef.size).toBe(0);
    const parsed = JSON.parse(built.payload) as { experiences: { bullets: unknown[] }[] };
    expect(parsed.experiences[0]?.bullets).toEqual([]);
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

  // ── M2-12 per-experience bullet selection ─────────────────────────────────
  it('maps a bullet block to ordered ids (reorder within an experience)', () => {
    const result = validateTailoringSpec(
      spec({ experienceBulletOrders: [{ experienceRef: 'e1', bulletOrder: ['e1b2', 'e1b1'] }] }),
      refs,
    );
    expect(result.spec).toBeDefined();
    expect([...(result.spec?.bulletIdOrderByExperienceId ?? new Map())]).toEqual([
      ['exp-acme', ['b-cut', 'b-led']],
    ]);
  });

  it('allows a SUBSET — omitting a bullet is valid, never a missing-ref (unlike orders)', () => {
    const result = validateTailoringSpec(
      spec({ experienceBulletOrders: [{ experienceRef: 'e1', bulletOrder: ['e1b1'] }] }),
      refs,
    );
    expect(result.missingRefCount).toBe(0);
    expect(result.spec?.bulletIdOrderByExperienceId.get('exp-acme')).toEqual(['b-led']);
  });

  it('an all-deselected block is valid (empty selection → the job still renders)', () => {
    const result = validateTailoringSpec(
      spec({ experienceBulletOrders: [{ experienceRef: 'e1', bulletOrder: [] }] }),
      refs,
    );
    expect(result.spec?.bulletIdOrderByExperienceId.get('exp-acme')).toEqual([]);
  });

  it('FLAGS a fabricated (unsent) bullet ref: spec undefined', () => {
    const result = validateTailoringSpec(
      spec({ experienceBulletOrders: [{ experienceRef: 'e1', bulletOrder: ['e1b9'] }] }),
      refs,
    );
    expect(result.spec).toBeUndefined();
    expect(result.fabricatedRefCount).toBe(1);
  });

  it('FLAGS a fabricated experience ref on a bullet block', () => {
    const result = validateTailoringSpec(
      spec({ experienceBulletOrders: [{ experienceRef: 'e9', bulletOrder: [] }] }),
      refs,
    );
    expect(result.spec).toBeUndefined();
    expect(result.fabricatedRefCount).toBe(1);
  });

  it('FLAGS a cross-experience bullet ref (a sent bullet from ANOTHER job) via the prefix guard', () => {
    // Two experiences: e1b1→b-a1, e2b1→b-g1. Selecting e2b1 under the e1 block
    // is a real ref but the wrong owner — structurally a fabrication.
    const twoExp = buildTailoringPayload(
      SKILLS,
      [
        {
          experienceId: 'exp-acme',
          company: 'Acme Analytics Co.',
          title: 'Senior Engineer',
          bullets: [{ bulletId: 'b-a1', text: 'Acme bullet.' }],
        },
        {
          experienceId: 'exp-globex',
          company: 'Globex Logistics',
          title: 'Engineer',
          bullets: [{ bulletId: 'b-g1', text: 'Globex bullet.' }],
        },
      ],
      PROJECTS,
      [gapInput()],
      [],
    );
    const result = validateTailoringSpec(
      {
        skillOrder: ['s2', 's1'],
        projectOrder: ['p1'],
        emphases: [],
        experienceBulletOrders: [{ experienceRef: 'e1', bulletOrder: ['e2b1'] }],
      },
      twoExp,
    );
    expect(result.spec).toBeUndefined();
    expect(result.fabricatedRefCount).toBe(1);
  });

  it('v1 compatibility: no bulletIdByRef in refs + no bullet orders → valid, empty bullet map', () => {
    const v1Refs = {
      skillIdByRef: refs.skillIdByRef,
      experienceIdByRef: refs.experienceIdByRef,
      projectIdByRef: refs.projectIdByRef,
      gapIdByRef: refs.gapIdByRef,
    };
    const result = validateTailoringSpec(spec(), v1Refs);
    expect(result.spec).toBeDefined();
    expect(result.spec?.bulletIdOrderByExperienceId.size).toBe(0);
  });
});
