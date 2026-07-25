import { describe, expect, it } from 'vitest';

import { SKILL_LEVELS } from './enums.ts';
import { profileSkillSchema, profileSkillWithDeclaredSchema } from './profile.ts';
import {
  SKILL_LEVEL_RANK,
  createSkillUpgradeBodySchema,
  maxSkillLevel,
  revokeSkillUpgradeBodySchema,
  skillNameKey,
  skillUpgradeSchema,
  skillUpgradeSuggestionSchema,
} from './skill-upgrades.ts';

// M3-06 core — pure helpers + wire contracts. All values fictional.

describe('skillNameKey (M0-08b park 3 — THE shared normalization)', () => {
  it('is exactly lower(name): case-folds, does NOT trim', () => {
    expect(skillNameKey('TypeScript')).toBe('typescript');
    expect(skillNameKey('POSTGRES')).toBe('postgres');
    // Deliberately NOT trim+lower — must match the DB lower(name) index exactly,
    // which preserves surrounding whitespace (the " TypeScript" probe).
    expect(skillNameKey(' TypeScript ')).toBe(' typescript ');
    expect(skillNameKey('')).toBe('');
  });
});

describe('SKILL_LEVEL_RANK (derived from SKILL_LEVELS array order)', () => {
  it('ranks expert highest, learning lowest, strictly monotonic', () => {
    expect(SKILL_LEVEL_RANK).toEqual({ expert: 3, solid: 2, rusty: 1, learning: 0 });
  });

  it('is derived from array order, not hardcoded (position law)', () => {
    // Rank = reverse index in SKILL_LEVELS; guards against the array and the map
    // drifting apart.
    for (const [index, level] of SKILL_LEVELS.entries()) {
      expect(SKILL_LEVEL_RANK[level]).toBe(SKILL_LEVELS.length - 1 - index);
    }
  });
});

describe('maxSkillLevel (the effective-level combinator)', () => {
  // Table-driven. These cases are the SLICE-1 PLANTED-FAIL target: inverting the
  // combinator (max -> min) must turn the elevation cases RED.
  const cases: Array<{ levels: readonly [string, ...string[]]; expected: string; why: string }> = [
    { levels: ['learning'], expected: 'learning', why: 'single arg is itself' },
    { levels: ['rusty', 'solid'], expected: 'solid', why: 'an earned solid raises rusty' },
    { levels: ['learning', 'solid'], expected: 'solid', why: 'an earned solid raises learning' },
    { levels: ['solid', 'solid'], expected: 'solid', why: 'idempotent at the earned target' },
    {
      // The load-bearing case: a later DECLARED promotion to expert must NOT be
      // capped by an older solid grant — max, never "earned overrides".
      levels: ['expert', 'solid'],
      expected: 'expert',
      why: 'declared expert is never suppressed by a lower earned grant',
    },
    {
      levels: ['rusty', 'solid', 'learning'],
      expected: 'solid',
      why: 'the highest of many wins regardless of order',
    },
    { levels: ['expert', 'expert'], expected: 'expert', why: 'idempotent at the top' },
  ];

  for (const { levels, expected, why } of cases) {
    it(`max(${levels.join(', ')}) = ${expected} — ${why}`, () => {
      const [first, ...rest] = levels as [
        (typeof SKILL_LEVELS)[number],
        ...(typeof SKILL_LEVELS)[number][],
      ];
      expect(maxSkillLevel(first, ...rest)).toBe(expected);
    });
  }

  it('is commutative over any argument order', () => {
    expect(maxSkillLevel('rusty', 'solid', 'learning')).toBe(
      maxSkillLevel('learning', 'rusty', 'solid'),
    );
  });
});

describe('profile wire schemas — declared/effective split (OD-7)', () => {
  it('profileSkillWithDeclaredSchema carries BOTH level (effective) and declaredLevel', () => {
    const elevated = profileSkillWithDeclaredSchema.parse({
      id: 'skill-1',
      name: 'TypeScript',
      category: 'language',
      level: 'solid', // effective (earned)
      declaredLevel: 'rusty', // markdown-owned
      years: 4,
      lastUsed: '2026-07-01',
    });
    expect(elevated.level).toBe('solid');
    expect(elevated.declaredLevel).toBe('rusty');
  });

  it('profileSkillWithDeclaredSchema requires declaredLevel', () => {
    const parsed = profileSkillWithDeclaredSchema.safeParse({
      id: 'skill-1',
      name: 'TypeScript',
      category: null,
      level: 'solid',
      years: null,
      lastUsed: null,
    });
    expect(parsed.success).toBe(false);
  });

  it('base profileSkillSchema STRIPS declaredLevel (the scoring-input invariant)', () => {
    // The fit engine consumes profileResponseSchema/profileSkillSchema; its
    // z.object parse must drop the extra declaredLevel the getProfile overlay
    // emits, so the deterministic engine reads effective-level only. If this
    // ever flips to strict/pass-through, scoring stops being provably unaffected.
    const parsed = profileSkillSchema.parse({
      id: 'skill-1',
      name: 'TypeScript',
      category: null,
      level: 'solid',
      declaredLevel: 'rusty',
      years: null,
      lastUsed: null,
    });
    expect('declaredLevel' in parsed).toBe(false);
  });
});

describe('wire body schemas', () => {
  it('createSkillUpgradeBodySchema accepts two uuids, rejects extras/non-uuid', () => {
    const ok = createSkillUpgradeBodySchema.safeParse({
      profileSkillId: '11111111-1111-4111-8111-111111111111',
      exerciseId: '22222222-2222-4222-8222-222222222222',
    });
    expect(ok.success).toBe(true);
    expect(
      createSkillUpgradeBodySchema.safeParse({ profileSkillId: 'nope', exerciseId: 'x' }).success,
    ).toBe(false);
    expect(
      createSkillUpgradeBodySchema.safeParse({
        profileSkillId: '11111111-1111-4111-8111-111111111111',
        exerciseId: '22222222-2222-4222-8222-222222222222',
        surprise: 1,
      }).success,
    ).toBe(false);
  });

  it('revokeSkillUpgradeBodySchema: note optional, trims, bounds length, rejects U+0000', () => {
    expect(revokeSkillUpgradeBodySchema.safeParse({}).success).toBe(true);
    expect(revokeSkillUpgradeBodySchema.safeParse({ note: '  wrong level  ' }).data?.note).toBe(
      'wrong level',
    );
    expect(revokeSkillUpgradeBodySchema.safeParse({ note: 'a'.repeat(1001) }).success).toBe(false);
    // A literal U+0000 in the note is rejected at the boundary (value-free 400).
    expect(revokeSkillUpgradeBodySchema.safeParse({ note: 'bad\u0000note' }).success).toBe(false);
  });
});

describe('wire read schemas (strict — unknown keys stripped/rejected)', () => {
  it('skillUpgradeSchema round-trips an active grant with evidence + detached', () => {
    const grant = {
      id: 'up-1',
      skillName: 'TypeScript',
      skillNameKey: 'typescript',
      fromLevel: 'rusty',
      toLevel: 'solid',
      status: 'active',
      revokedAt: null,
      revokeNote: null,
      exerciseId: 'ex-1',
      exerciseTitle: 'Build a typed parser',
      detached: false,
      evidence: [
        { kind: 'implemented', artifactUrl: 'https://example.test/repo', recordedOn: '2026-07-10' },
        { kind: 'tested', artifactUrl: null, recordedOn: '2026-07-11' },
      ],
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    expect(skillUpgradeSchema.parse(grant)).toEqual(grant);
  });

  it('skillUpgradeSuggestionSchema round-trips a grouped suggestion', () => {
    const suggestion = {
      profileSkillId: 'skill-1',
      skillName: 'TypeScript',
      currentLevel: 'rusty',
      suggestedLevel: 'solid',
      exercises: [
        {
          exerciseId: 'ex-1',
          title: 'Build a typed parser',
          completedOn: '2026-07-10',
          matchedRequirements: [{ gapId: 'gap-1', requirementId: 'req-1', text: 'TypeScript' }],
        },
      ],
    };
    expect(skillUpgradeSuggestionSchema.parse(suggestion)).toEqual(suggestion);
  });
});
