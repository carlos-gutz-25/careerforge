import {
  skillNameKey,
  type CreateSkillUpgradeBody,
  type RevokeSkillUpgradeBody,
  type SkillUpgrade,
  type SkillUpgradeSuggestion,
  type SkillUpgradeSuggestionsResponse,
  type SkillUpgradesResponse,
} from '@careerforge/core';
import {
  pgErrorCode,
  type ExerciseUpgradeRead,
  type GapRequirementRead,
  type MasteryEvidenceEmbedRead,
  type ProfileRepository,
  type SkillUpgradesRepository,
  type SkillUpgradeWithEvidence,
} from '@careerforge/db';
import {
  suggestSkillUpgrades,
  type SuggestUpgradesExercise,
  type SuggestUpgradesInput,
} from '@careerforge/scoring';

// M3-06: Evidence -> profile upgrades (ADR-0014). Deterministic suggest-and-
// confirm — NO LLM. GET recomputes suggestions per request (nothing stored,
// nothing stale — the review-queue projection pattern). POST re-derives the
// suggestion SERVER-SIDE from the exercise + profile state (zero client trust,
// the M3-04 server-anchored precedent) before persisting a grant + ALL of the
// exercise's evidence snapshots. Revoke is a status flip. Every cross-module
// read is a NARROW read-only view.

export class SkillUpgradeSkillNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'SKILL_NOT_FOUND';
  constructor() {
    // Id-free: the skill id is caller-supplied; missing or foreign is one 404.
    super('profile skill not found');
  }
}

export class SkillUpgradeExerciseNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'EXERCISE_NOT_FOUND';
  constructor() {
    super('exercise not found');
  }
}

export class SkillUpgradeNotDerivableError extends Error {
  readonly statusCode = 409;
  readonly code = 'UPGRADE_NOT_DERIVABLE';
  constructor() {
    // The (skill, exercise) pair does not yield a suggestion: exercise not
    // complete, evidence not full (OD-3), no phrase match, or the skill's
    // effective level is already >= the earned target. Value-free.
    super('no upgrade is derivable for this skill and exercise');
  }
}

export class SkillUpgradeAlreadyActiveError extends Error {
  readonly statusCode = 409;
  readonly code = 'UPGRADE_ALREADY_ACTIVE';
  constructor() {
    // The partial unique index backstop (a raced duplicate must not 500).
    super('an active upgrade already exists for this skill');
  }
}

export class SkillUpgradeNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('skill upgrade not found');
  }
}

export class SkillUpgradeAlreadyRevokedError extends Error {
  readonly statusCode = 409;
  readonly code = 'UPGRADE_ALREADY_REVOKED';
  constructor() {
    super('this upgrade is already revoked');
  }
}

export interface SkillUpgradesService {
  /** GET /skill-upgrade-suggestions — recomputed per request. */
  listSuggestions(userId: string): Promise<SkillUpgradeSuggestionsResponse>;
  /** POST /skill-upgrades — confirm a server-re-derived upgrade. */
  create(userId: string, body: CreateSkillUpgradeBody): Promise<SkillUpgrade>;
  /** GET /skill-upgrades — the audit view (active + revoked). */
  listGrants(userId: string): Promise<SkillUpgradesResponse>;
  /** POST /skill-upgrades/:id/revoke — flip an active grant to revoked. */
  revoke(userId: string, upgradeId: string, body: RevokeSkillUpgradeBody): Promise<SkillUpgrade>;
}

/** Repository grant view -> the wire contract. `user_id` never crosses the wire;
 *  timestamps become ISO strings; evidence is projected to its snapshot fields. */
function toWire(view: SkillUpgradeWithEvidence): SkillUpgrade {
  const { grant, evidence, detached } = view;
  return {
    id: grant.id,
    skillName: grant.skillName,
    skillNameKey: grant.skillNameKey,
    fromLevel: grant.fromLevel,
    toLevel: grant.toLevel,
    status: grant.status,
    revokedAt: grant.revokedAt ? grant.revokedAt.toISOString() : null,
    revokeNote: grant.revokeNote,
    exerciseId: grant.exerciseId,
    exerciseTitle: grant.exerciseTitle,
    detached,
    evidence: evidence.map((row) => ({
      kind: row.kind,
      artifactUrl: row.artifactUrl,
      recordedOn: row.recordedOn,
    })),
    createdAt: grant.createdAt.toISOString(),
  };
}

export function createSkillUpgradesService(deps: {
  skillUpgrades: SkillUpgradesRepository;
  exercises: ExerciseUpgradeRead;
  masteryEvidence: MasteryEvidenceEmbedRead;
  gaps: GapRequirementRead;
  /** Read-only: only getProfile is used (effective + declared skill levels). */
  profile: Pick<ProfileRepository, 'getProfile'>;
}): SkillUpgradesService {
  const { skillUpgrades, exercises, masteryEvidence, gaps, profile } = deps;

  /** Assemble the pure engine's exercise inputs for a set of completed
   *  exercises: their evidence kinds + gap-joined requirements. */
  async function buildExerciseInputs(
    userId: string,
    completed: { id: string; title: string; completedOn: string }[],
  ): Promise<SuggestUpgradesExercise[]> {
    const exerciseIds = completed.map((exercise) => exercise.id);
    const [evidenceByExercise, gapIdsByExercise] = await Promise.all([
      masteryEvidence.listEvidenceByExerciseIds(userId, exerciseIds),
      exercises.gapIdsByExercise(userId, exerciseIds),
    ]);
    const allGapIds = [...new Set([...gapIdsByExercise.values()].flat())];
    const requirements = await gaps.findRequirementsByGapIds(userId, allGapIds);
    const requirementByGap = new Map(requirements.map((row) => [row.gapId, row]));

    return completed.map((exercise) => ({
      id: exercise.id,
      title: exercise.title,
      completedOn: exercise.completedOn,
      evidenceKinds: new Set((evidenceByExercise.get(exercise.id) ?? []).map((row) => row.kind)),
      requirements: (gapIdsByExercise.get(exercise.id) ?? []).flatMap((gapId) => {
        const requirement = requirementByGap.get(gapId);
        return requirement
          ? [
              {
                gapId: requirement.gapId,
                requirementId: requirement.requirementId,
                text: requirement.text,
                sourceQuote: requirement.sourceQuote,
              },
            ]
          : [];
      }),
    }));
  }

  async function profileSkillsForSuggest(userId: string): Promise<SuggestUpgradesInput['skills']> {
    const { skills } = await profile.getProfile(userId);
    return skills.map((skill) => ({ id: skill.id, name: skill.name, effectiveLevel: skill.level }));
  }

  return {
    async listSuggestions(userId) {
      const completed = await exercises.listCompletedExercises(userId);
      if (completed.length === 0) return { suggestions: [] };
      const [skills, exerciseInputs] = await Promise.all([
        profileSkillsForSuggest(userId),
        buildExerciseInputs(userId, completed),
      ]);
      return { suggestions: suggestSkillUpgrades({ skills, exercises: exerciseInputs }) };
    },

    async create(userId, body) {
      // Resolve the two references FIRST (404 before 409, the M3-04 order).
      const skills = await profileSkillsForSuggest(userId);
      const skill = skills.find((candidate) => candidate.id === body.profileSkillId);
      if (!skill) throw new SkillUpgradeSkillNotFoundError();

      const exercise = await exercises.findExercise(userId, body.exerciseId);
      if (!exercise) throw new SkillUpgradeExerciseNotFoundError();

      // Re-derive the suggestion server-side over just this skill + exercise. A
      // non-complete exercise has no completedOn and is not derivable; guard it
      // out before feeding the engine (which requires a completion date).
      let suggestion: SkillUpgradeSuggestion | undefined;
      if (exercise.row.status === 'complete' && exercise.row.completedOn !== null) {
        const [exerciseInput] = await buildExerciseInputs(userId, [
          { id: exercise.row.id, title: exercise.row.title, completedOn: exercise.row.completedOn },
        ]);
        const derived = suggestSkillUpgrades({
          skills: [skill],
          exercises: exerciseInput ? [exerciseInput] : [],
        });
        suggestion = derived.find(
          (candidate) =>
            candidate.profileSkillId === skill.id &&
            candidate.exercises.some((entry) => entry.exerciseId === exercise.row.id),
        );
      }
      if (!suggestion) throw new SkillUpgradeNotDerivableError();

      // Snapshot ALL of the exercise's evidence (not just the predicate trio).
      const evidenceByExercise = await masteryEvidence.listEvidenceByExerciseIds(userId, [
        exercise.row.id,
      ]);
      const evidenceRows = evidenceByExercise.get(exercise.row.id) ?? [];

      try {
        const created = await skillUpgrades.createGrantWithEvidence(userId, {
          profileSkillId: skill.id,
          skillName: skill.name,
          skillNameKey: skillNameKey(skill.name),
          fromLevel: suggestion.currentLevel,
          toLevel: suggestion.suggestedLevel,
          exerciseId: exercise.row.id,
          exerciseTitle: exercise.row.title,
          evidence: evidenceRows.map((row) => ({
            masteryEvidenceId: row.id,
            kind: row.kind,
            artifactUrl: row.artifactUrl,
            recordedOn: row.recordedOn,
          })),
        });
        return toWire(created);
      } catch (error) {
        // The partial-unique backstop: a raced duplicate active grant is a 409,
        // never a 500 (the whole insert tx rolled back).
        if (pgErrorCode(error) === '23505') throw new SkillUpgradeAlreadyActiveError();
        throw error;
      }
    },

    async listGrants(userId) {
      const grants = await skillUpgrades.listGrants(userId);
      return { upgrades: grants.map(toWire) };
    },

    async revoke(userId, upgradeId, body) {
      const outcome = await skillUpgrades.revokeGrant(userId, upgradeId, body.note ?? null);
      if (outcome === 'not_found') throw new SkillUpgradeNotFoundError();
      if (outcome === 'already_revoked') throw new SkillUpgradeAlreadyRevokedError();
      const view = await skillUpgrades.findGrant(userId, upgradeId);
      // Just revoked in the same request; the row is present.
      if (!view) throw new SkillUpgradeNotFoundError();
      return toWire(view);
    },
  };
}
