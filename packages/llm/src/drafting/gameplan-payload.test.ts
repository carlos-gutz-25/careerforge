import { describe, expect, it } from 'vitest';

import {
  buildGameplanPayload,
  GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP,
  GAMEPLAN_STORY_CITATIONS_MAX,
  type GameplanEvidenceInput,
  type GameplanImprovementPlanInput,
  type GameplanRequirementInput,
  type GameplanSkillInput,
} from './gameplan-payload.ts';

// Pure unit tests over the M7-06 gameplan payload builder (D5). Fictional inputs
// only - no DB, no provider, no real profile data. Verifies: the strict === true
// filter (+ counts), refs assigned once and positionally, the per-requirement
// evidence cap, refless inline gaps (absent-not-null), the reviewed-only
// improvement-plan guidance law, and the evidenceByRef (link id, owning ref)
// round-trip.

const SKILLS: readonly GameplanSkillInput[] = [
  { name: 'TypeScript', level: 'solid' },
  { name: 'PostgreSQL', level: 'rusty' },
];

function requirement(
  overrides: Partial<GameplanRequirementInput> & Pick<GameplanRequirementInput, 'requirementId'>,
): GameplanRequirementInput {
  return {
    quoteVerified: true,
    text: 'Build and operate TypeScript services.',
    kind: 'must_have',
    category: 'framework',
    gap: null,
    ...overrides,
  };
}

function evidence(
  overrides: Partial<GameplanEvidenceInput> &
    Pick<GameplanEvidenceInput, 'evidenceLinkId' | 'requirementId'>,
): GameplanEvidenceInput {
  return {
    strength: 'direct',
    postingQuote: 'strong TypeScript background required',
    profileQuote: 'shipped a TypeScript platform',
    ...overrides,
  };
}

describe('buildGameplanPayload', () => {
  it('the two caps are one number by construction (the D5 identity pin)', () => {
    expect(GAMEPLAN_STORY_CITATIONS_MAX).toBe(GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP);
    expect(GAMEPLAN_STORY_CITATIONS_MAX).toBe(3);
  });

  it('assigns r/e refs once, positionally, in requirement order; evidenceByRef round-trips', () => {
    const built = buildGameplanPayload(
      SKILLS,
      [requirement({ requirementId: 'req-a' }), requirement({ requirementId: 'req-b' })],
      [
        evidence({ evidenceLinkId: 'el-a1', requirementId: 'req-a' }),
        evidence({ evidenceLinkId: 'el-b1', requirementId: 'req-b' }),
        evidence({ evidenceLinkId: 'el-a2', requirementId: 'req-a' }),
      ],
      null,
    );

    expect(built.verifiedRequirementCount).toBe(2);
    expect(built.excludedRequirementCount).toBe(0);
    expect(new Map(built.requirementIdByRef)).toEqual(
      new Map([
        ['r1', 'req-a'],
        ['r2', 'req-b'],
      ]),
    );
    // e-refs numbered globally in requirement order: req-a's evidence first
    // (e1, e2), then req-b's (e3).
    expect(built.evidenceByRef.get('e1')).toEqual({
      evidenceLinkId: 'el-a1',
      requirementRef: 'r1',
    });
    expect(built.evidenceByRef.get('e2')).toEqual({
      evidenceLinkId: 'el-a2',
      requirementRef: 'r1',
    });
    expect(built.evidenceByRef.get('e3')).toEqual({
      evidenceLinkId: 'el-b1',
      requirementRef: 'r2',
    });
    expect(built.evidenceByRef.size).toBe(3);
  });

  it('strict === true filter: false AND null requirements are excluded, counted, and their evidence dropped', () => {
    const built = buildGameplanPayload(
      SKILLS,
      [
        requirement({ requirementId: 'req-keep' }),
        requirement({ requirementId: 'req-false', quoteVerified: false }),
        requirement({ requirementId: 'req-null', quoteVerified: null }),
      ],
      [
        evidence({ evidenceLinkId: 'el-keep', requirementId: 'req-keep' }),
        evidence({ evidenceLinkId: 'el-false', requirementId: 'req-false' }),
        evidence({ evidenceLinkId: 'el-null', requirementId: 'req-null' }),
      ],
      null,
    );

    expect(built.verifiedRequirementCount).toBe(1);
    expect(built.excludedRequirementCount).toBe(2);
    // Only the kept requirement is referenced.
    expect(new Map(built.requirementIdByRef)).toEqual(new Map([['r1', 'req-keep']]));
    // Only the kept requirement's evidence exists; excluded evidence is gone
    // from both the ref map and the payload string.
    expect(built.evidenceByRef.size).toBe(1);
    expect(built.evidenceByRef.get('e1')).toEqual({
      evidenceLinkId: 'el-keep',
      requirementRef: 'r1',
    });
    expect(built.payload).toContain('shipped a TypeScript platform');
    expect(built.payload).not.toContain('el-false');
    expect(built.payload).not.toContain('el-null');
  });

  it('caps evidence at GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP per requirement', () => {
    const built = buildGameplanPayload(
      SKILLS,
      [requirement({ requirementId: 'req-rich' })],
      [
        evidence({ evidenceLinkId: 'el-1', requirementId: 'req-rich' }),
        evidence({ evidenceLinkId: 'el-2', requirementId: 'req-rich' }),
        evidence({ evidenceLinkId: 'el-3', requirementId: 'req-rich' }),
        evidence({ evidenceLinkId: 'el-4', requirementId: 'req-rich' }),
      ],
      null,
    );
    // Only the first 3 (the cap) are sent; the 4th is dropped.
    expect(built.evidenceByRef.size).toBe(GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP);
    expect(built.evidenceByRef.has('e3')).toBe(true);
    expect(built.evidenceByRef.has('e4')).toBe(false);
    expect(built.payload).not.toContain('el-4');
  });

  it('serializes gapClassification inline (refless) only when a gap row exists; absent otherwise', () => {
    const built = buildGameplanPayload(
      SKILLS,
      [
        requirement({
          requirementId: 'req-gap',
          gap: { gapId: 'gap-1', classification: 'genuine_gap' },
        }),
        requirement({ requirementId: 'req-nogap', gap: null }),
      ],
      [],
      null,
    );
    const parsed = JSON.parse(built.payload) as {
      requirements: { ref: string; gapClassification?: string }[];
    };
    const gapReq = parsed.requirements.find((r) => r.ref === 'r1');
    const noGapReq = parsed.requirements.find((r) => r.ref === 'r2');
    expect(gapReq?.gapClassification).toBe('genuine_gap');
    // Absent field, not null (Object.hasOwn distinguishes the two).
    expect(noGapReq && Object.hasOwn(noGapReq, 'gapClassification')).toBe(false);
    // Gaps get no refs: no gap id anywhere in the payload.
    expect(built.payload).not.toContain('gap-1');
  });

  it('improvement plan null -> no key, count 0', () => {
    const built = buildGameplanPayload(SKILLS, [requirement({ requirementId: 'r' })], [], null);
    expect(built.includedPlanItemCount).toBe(0);
    expect(built.payload).not.toContain('improvementPlan');
  });

  it('improvement plan in DRAFT status -> excluded (the iff-reviewed law), no key, count 0', () => {
    const draftPlan: GameplanImprovementPlanInput = {
      reviewStatus: 'draft',
      items: [{ action: 'Practice system design weekly', priority: 'high' }],
    };
    const built = buildGameplanPayload(
      SKILLS,
      [requirement({ requirementId: 'r' })],
      [],
      draftPlan,
    );
    expect(built.includedPlanItemCount).toBe(0);
    expect(built.payload).not.toContain('improvementPlan');
    expect(built.payload).not.toContain('Practice system design weekly');
  });

  it('improvement plan REVIEWED with items -> key present with action+priority ONLY (no ids/refs), count set', () => {
    const reviewedPlan: GameplanImprovementPlanInput = {
      reviewStatus: 'reviewed',
      items: [
        { action: 'Rebuild PostgreSQL indexing fundamentals', priority: 'high' },
        { action: 'Add observability to a side project', priority: 'medium' },
      ],
    };
    const built = buildGameplanPayload(
      SKILLS,
      [requirement({ requirementId: 'r' })],
      [],
      reviewedPlan,
    );
    expect(built.includedPlanItemCount).toBe(2);
    const parsed = JSON.parse(built.payload) as {
      improvementPlan?: { items: Record<string, unknown>[] };
    };
    expect(parsed.improvementPlan?.items).toEqual([
      { action: 'Rebuild PostgreSQL indexing fundamentals', priority: 'high' },
      { action: 'Add observability to a side project', priority: 'medium' },
    ]);
    // action + priority ONLY - the item objects carry exactly those two keys,
    // so no id or ref code ever attaches to a guidance item (the model cannot
    // cite it).
    for (const item of parsed.improvementPlan?.items ?? []) {
      expect(Object.keys(item).sort()).toEqual(['action', 'priority']);
    }
  });

  it('improvement plan REVIEWED but EMPTY -> excluded, no key, count 0', () => {
    const emptyReviewed: GameplanImprovementPlanInput = { reviewStatus: 'reviewed', items: [] };
    const built = buildGameplanPayload(
      SKILLS,
      [requirement({ requirementId: 'r' })],
      [],
      emptyReviewed,
    );
    expect(built.includedPlanItemCount).toBe(0);
    expect(built.payload).not.toContain('improvementPlan');
  });

  it('the payload is valid JSON and carries the profile skills verbatim', () => {
    const built = buildGameplanPayload(SKILLS, [requirement({ requirementId: 'r' })], [], null);
    const parsed = JSON.parse(built.payload) as {
      profileSkills: { name: string; level: string }[];
    };
    expect(parsed.profileSkills).toEqual([
      { name: 'TypeScript', level: 'solid' },
      { name: 'PostgreSQL', level: 'rusty' },
    ]);
  });
});
