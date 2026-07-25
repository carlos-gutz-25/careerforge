import { type EvidenceKind, type SkillLevel } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import {
  hasFullMasteryEvidence,
  suggestSkillUpgrades,
  type SuggestUpgradesExercise,
  type SuggestUpgradesInput,
  type SuggestUpgradesSkill,
} from './suggest-upgrades.ts';

// M3-06 upgrade-suggestion engine — pure, deterministic. ALL data fictional
// (Alex Rivera vocabulary, invented ids). The full-evidence predicate case is
// the SLICE-2 planted-FAIL target: dropping `explained` from the predicate must
// turn the "no suggestion without explained" test RED.

const kinds = (...ks: EvidenceKind[]): ReadonlySet<EvidenceKind> => new Set(ks);
const FULL: EvidenceKind[] = ['implemented', 'tested', 'explained'];

const skill = (id: string, name: string, effectiveLevel: SkillLevel): SuggestUpgradesSkill => ({
  id,
  name,
  effectiveLevel,
});

const exercise = (
  over: Partial<SuggestUpgradesExercise> & { id: string },
): SuggestUpgradesExercise => ({
  title: 'Build a typed parser',
  completedOn: '2026-07-10',
  evidenceKinds: kinds(...FULL),
  requirements: [
    {
      gapId: 'gap-ts',
      requirementId: 'req-ts',
      text: 'Strong TypeScript',
      sourceQuote: 'TypeScript required',
    },
  ],
  ...over,
});

describe('hasFullMasteryEvidence (OD-3 predicate — the sole definition)', () => {
  it('requires implemented AND tested AND explained; revisited excluded', () => {
    expect(hasFullMasteryEvidence(kinds('implemented', 'tested', 'explained'))).toBe(true);
    // extra kinds (incl. revisited) don't disqualify
    expect(hasFullMasteryEvidence(kinds('implemented', 'tested', 'explained', 'revisited'))).toBe(
      true,
    );
    // any one of the trio missing => not full
    expect(hasFullMasteryEvidence(kinds('implemented', 'tested'))).toBe(false);
    expect(hasFullMasteryEvidence(kinds('implemented', 'explained'))).toBe(false);
    expect(hasFullMasteryEvidence(kinds('tested', 'explained'))).toBe(false);
    // completion-only (implemented+tested+revisited) is NOT full — the M3-05
    // retention axis can't substitute for the acquisition trio.
    expect(hasFullMasteryEvidence(kinds('implemented', 'tested', 'revisited'))).toBe(false);
  });
});

describe('suggestSkillUpgrades — happy path', () => {
  it('suggests solid for a rusty skill matched by a fully-evidenced exercise', () => {
    const input: SuggestUpgradesInput = {
      skills: [skill('skill-ts', 'TypeScript', 'rusty')],
      exercises: [exercise({ id: 'ex-1' })],
    };
    expect(suggestSkillUpgrades(input)).toEqual([
      {
        profileSkillId: 'skill-ts',
        skillName: 'TypeScript',
        currentLevel: 'rusty',
        suggestedLevel: 'solid',
        exercises: [
          {
            exerciseId: 'ex-1',
            title: 'Build a typed parser',
            completedOn: '2026-07-10',
            matchedRequirements: [
              { gapId: 'gap-ts', requirementId: 'req-ts', text: 'Strong TypeScript' },
            ],
          },
        ],
      },
    ]);
  });

  it('suggests solid for a learning skill too (both suggestible starts -> solid)', () => {
    const out = suggestSkillUpgrades({
      skills: [skill('skill-ts', 'TypeScript', 'learning')],
      exercises: [exercise({ id: 'ex-1' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.currentLevel).toBe('learning');
    expect(out[0]!.suggestedLevel).toBe('solid');
  });
});

describe('suggestSkillUpgrades — the never-suggest set', () => {
  it('does NOT suggest for expert or solid skills (already >= target)', () => {
    const exercises = [exercise({ id: 'ex-1' })];
    expect(
      suggestSkillUpgrades({ skills: [skill('s', 'TypeScript', 'expert')], exercises }),
    ).toEqual([]);
    expect(
      suggestSkillUpgrades({ skills: [skill('s', 'TypeScript', 'solid')], exercises }),
    ).toEqual([]);
  });

  it('does NOT suggest when the exercise lacks full evidence (no `explained`)', () => {
    // SLICE-2 PLANTED-FAIL anchor: with the predicate intact this is []. If the
    // predicate drops the `explained` requirement, this exercise becomes
    // eligible and a suggestion appears -> RED.
    const out = suggestSkillUpgrades({
      skills: [skill('skill-ts', 'TypeScript', 'rusty')],
      exercises: [exercise({ id: 'ex-1', evidenceKinds: kinds('implemented', 'tested') })],
    });
    expect(out).toEqual([]);
  });

  it('does NOT suggest when no requirement phrase-matches the skill name', () => {
    const out = suggestSkillUpgrades({
      skills: [skill('skill-k8s', 'Kubernetes', 'rusty')],
      exercises: [exercise({ id: 'ex-1' })], // requirement is about TypeScript
    });
    expect(out).toEqual([]);
  });

  it('does NOT suggest for a skill absent from the profile (no row creation)', () => {
    // Only skills passed in are considered; an unlisted skill never appears.
    const out = suggestSkillUpgrades({
      skills: [],
      exercises: [exercise({ id: 'ex-1' })],
    });
    expect(out).toEqual([]);
  });

  it('does NOT suggest from an exercise with no requirements', () => {
    const out = suggestSkillUpgrades({
      skills: [skill('skill-ts', 'TypeScript', 'rusty')],
      exercises: [exercise({ id: 'ex-1', requirements: [] })],
    });
    expect(out).toEqual([]);
  });
});

describe('suggestSkillUpgrades — grouping + deterministic order', () => {
  it('groups multiple exercises under one skill, sorted by (completedOn, id)', () => {
    const reqTs = {
      gapId: 'g1',
      requirementId: 'req-ts',
      text: 'TypeScript',
      sourceQuote: 'TypeScript',
    };
    const input: SuggestUpgradesInput = {
      skills: [skill('skill-ts', 'TypeScript', 'rusty')],
      exercises: [
        exercise({ id: 'ex-late', completedOn: '2026-07-20', requirements: [reqTs] }),
        exercise({ id: 'ex-early', completedOn: '2026-07-01', requirements: [reqTs] }),
        // same day as ex-early's neighbor — tiebreak by id
        exercise({ id: 'ex-a', completedOn: '2026-07-01', requirements: [reqTs] }),
      ],
    };
    const out = suggestSkillUpgrades(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.exercises.map((e) => e.exerciseId)).toEqual(['ex-a', 'ex-early', 'ex-late']);
  });

  it('sorts suggestions by skillNameKey then profileSkillId, and matched reqs by requirementId', () => {
    // Single-token skill names so each matches single-token requirement text.
    const reqDockerZ = {
      gapId: 'gz',
      requirementId: 'req-z',
      text: 'Docker',
      sourceQuote: 'Docker',
    };
    const reqDockerA = {
      gapId: 'ga',
      requirementId: 'req-a',
      text: 'Docker containers',
      sourceQuote: 'Docker containers',
    };
    const reqNode = { gapId: 'gn', requirementId: 'req-n', text: 'node', sourceQuote: 'node' };
    const input: SuggestUpgradesInput = {
      // Deliberately pass "node" first though it sorts AFTER "Docker".
      skills: [skill('s-node', 'node', 'rusty'), skill('s-docker', 'Docker', 'learning')],
      exercises: [exercise({ id: 'ex-1', requirements: [reqDockerZ, reqDockerA, reqNode] })],
    };
    const out = suggestSkillUpgrades(input);
    // key 'docker' < 'node' — sorted regardless of input order
    expect(out.map((s) => s.skillName)).toEqual(['Docker', 'node']);
    // Docker matched req-z and req-a; sorted by requirementId asc
    expect(out[0]!.exercises[0]!.matchedRequirements.map((r) => r.requirementId)).toEqual([
      'req-a',
      'req-z',
    ]);
    // node matched only its own requirement
    expect(out[1]!.exercises[0]!.matchedRequirements.map((r) => r.requirementId)).toEqual([
      'req-n',
    ]);
  });
});
