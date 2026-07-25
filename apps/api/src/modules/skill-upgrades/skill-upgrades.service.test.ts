import { describe, expect, it } from 'vitest';
import {
  type ExerciseUpgradeRead,
  type GapRequirementRead,
  type MasteryEvidenceEmbedRead,
  type MasteryEvidenceRow,
  type ProfileRepository,
  type SkillUpgradesRepository,
} from '@careerforge/db';

import {
  SkillUpgradeAlreadyActiveError,
  createSkillUpgradesService,
} from './skill-upgrades.service.ts';

// Unit test for the ONE service path the integration tests cannot reach
// deterministically: the 23505 -> 409 UPGRADE_ALREADY_ACTIVE backstop. Once a
// grant is active the getProfile overlay makes the skill effective-solid, so a
// sequential repeat POST is UPGRADE_NOT_DERIVABLE (covered in the route tests);
// the unique-index violation only fires under a true concurrency race. We drive
// it here with a stub repository that throws 23505 from an otherwise-derivable
// request, proving a raced duplicate is a clean 409, never a 500.

const now = new Date('2026-07-12T00:00:00Z');

const evidenceRow = (kind: MasteryEvidenceRow['kind']): MasteryEvidenceRow => ({
  id: `ev-${kind}`,
  userId: 'u1',
  exerciseId: 'e1',
  kind,
  artifactUrl: null,
  recordedOn: '2026-07-10',
  createdAt: now,
  updatedAt: now,
});

const profile: Pick<ProfileRepository, 'getProfile'> = {
  getProfile: () =>
    Promise.resolve({
      skills: [
        {
          id: 's1',
          userId: 'u1',
          name: 'TypeScript',
          category: 'language',
          level: 'rusty', // effective still rusty -> derivable (the race window)
          declaredLevel: 'rusty',
          years: null,
          lastUsed: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      experiences: [],
      projects: [],
    }),
};

const exercises: ExerciseUpgradeRead = {
  listCompletedExercises: () => Promise.resolve([]),
  findExercise: () =>
    Promise.resolve({
      row: {
        id: 'e1',
        userId: 'u1',
        learningPlanId: 'p1',
        title: 'Build a typed parser',
        kind: 'kata',
        status: 'complete',
        position: 0,
        completedOn: '2026-07-10',
        createdAt: now,
        updatedAt: now,
      },
      gapIds: ['g1'],
    }),
  gapIdsByExercise: () => Promise.resolve(new Map([['e1', ['g1']]])),
};

const masteryEvidence: MasteryEvidenceEmbedRead = {
  listEvidenceByExerciseIds: () =>
    Promise.resolve(
      new Map([
        ['e1', [evidenceRow('implemented'), evidenceRow('tested'), evidenceRow('explained')]],
      ]),
    ),
};

const gaps: GapRequirementRead = {
  findRequirementsByGapIds: () =>
    Promise.resolve([
      { gapId: 'g1', requirementId: 'r1', text: 'TypeScript', sourceQuote: 'TypeScript' },
    ]),
};

/** A pg unique_violation as drizzle surfaces it: an Error carrying `.code`. */
const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' });

/** A repo stub whose grant insert loses the race with a wrapped 23505. */
const racingRepo: Pick<SkillUpgradesRepository, 'createGrantWithEvidence'> = {
  createGrantWithEvidence: () => Promise.reject(uniqueViolation()),
};

describe('POST /skill-upgrades — 23505 backstop (race-only)', () => {
  it('maps a unique_violation from the grant insert to 409 UPGRADE_ALREADY_ACTIVE', async () => {
    const service = createSkillUpgradesService({
      skillUpgrades: racingRepo as SkillUpgradesRepository,
      exercises,
      masteryEvidence,
      gaps,
      profile,
    });
    await expect(
      service.create('u1', { profileSkillId: 's1', exerciseId: 'e1' }),
    ).rejects.toBeInstanceOf(SkillUpgradeAlreadyActiveError);
  });

  it('a non-23505 error is NOT swallowed (rethrown as-is)', async () => {
    const boomRepo: Pick<SkillUpgradesRepository, 'createGrantWithEvidence'> = {
      createGrantWithEvidence: () => Promise.reject(new Error('boom')),
    };
    const service = createSkillUpgradesService({
      skillUpgrades: boomRepo as SkillUpgradesRepository,
      exercises,
      masteryEvidence,
      gaps,
      profile,
    });
    await expect(service.create('u1', { profileSkillId: 's1', exerciseId: 'e1' })).rejects.toThrow(
      'boom',
    );
  });
});
