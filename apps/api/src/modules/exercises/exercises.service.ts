import { type CreateExerciseBody, type Exercise, type ExercisePatchBody } from '@careerforge/core';
import {
  type ExercisesRepository,
  type ExerciseWithGaps,
  type MasteryEvidenceGateRead,
} from '@careerforge/db';

// M3-02: exercises linked to gaps — deterministic user-authored CRUD (NO LLM).
// An exercise belongs to one learning plan (M3-01) and cites the gaps it
// addresses. Preconditions run in order before any write: plan owned/exists
// (404) → every cited gap is one the plan cites (409). Gap membership is a
// SERVICE precondition (not a schema FK), per ADR-0013's precedent.

export class ExercisePlanNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Id-free: the plan id is caller-supplied body input; missing or foreign is
    // one 404 outcome (the user-scoped read law).
    super('learning plan not found');
  }
}

export class ExerciseGapNotInPlanError extends Error {
  readonly statusCode = 409;
  readonly code = 'EXERCISE_GAP_NOT_IN_PLAN';
  constructor() {
    // An exercise may only cite gaps its own plan already cites. Value-free:
    // the offending gap id is caller input and never echoed.
    super('one or more gaps are not cited by this learning plan');
  }
}

export class ExerciseNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('exercise not found');
  }
}

export class ExerciseIncompleteEvidenceError extends Error {
  readonly statusCode = 409;
  readonly code = 'EXERCISE_INCOMPLETE_EVIDENCE';
  constructor() {
    // The completion gate (M3-03 D1) spans exercises <-> mastery_evidence: an
    // exercise may become `complete` only with >=1 implemented AND >=1 tested
    // evidence. Value-free: no ids or counts in the message.
    super('an exercise cannot be completed without implemented and tested evidence');
  }
}

export interface ExercisesService {
  /** POST /exercises — create under a plan, citing gaps that plan cites. */
  create(userId: string, body: CreateExerciseBody): Promise<Exercise>;
  /** PATCH /exercises/:id — full-replacement of status (the only mutable
   *  field); 404 when missing/foreign. */
  updateStatus(userId: string, exerciseId: string, body: ExercisePatchBody): Promise<Exercise>;
  /** DELETE /exercises/:id — owner-scoped hard delete (the mis-create
   *  recourse); 404 when missing/foreign. */
  remove(userId: string, exerciseId: string): Promise<void>;
}

/** Row → the exercise wire contract. The title is user-authored and UNTRUSTED
 *  on display; gapIds are the structural citation. */
function toWire(exercise: ExerciseWithGaps): Exercise {
  return {
    id: exercise.row.id,
    learningPlanId: exercise.row.learningPlanId,
    title: exercise.row.title,
    kind: exercise.row.kind,
    status: exercise.row.status,
    position: exercise.row.position,
    gapIds: exercise.gapIds,
    createdAt: exercise.row.createdAt.toISOString(),
  };
}

export function createExercisesService(deps: {
  exercises: ExercisesRepository;
  /** The M3-03 completion gate read — a NARROW read-only view (only
   *  hasRequiredEvidence), so this module cannot mutate evidence. */
  masteryEvidence: MasteryEvidenceGateRead;
}): ExercisesService {
  const { exercises, masteryEvidence } = deps;

  return {
    async create(userId, body) {
      // Collapse duplicate ids: the join is UNIQUE(exercise, gap) and the
      // membership check compares the DISTINCT set.
      const gapIds = [...new Set(body.gapIds)];
      const citedGapIds = await exercises.findPlanCitedGapIds(userId, body.learningPlanId);
      // Plan missing or foreign → 404, BEFORE any membership check or write.
      if (citedGapIds === undefined) throw new ExercisePlanNotFoundError();
      // Every cited gap must be one the plan cites (a gap the caller does not
      // own is simply absent from this set) → 409.
      const cited = new Set(citedGapIds);
      if (gapIds.some((gapId) => !cited.has(gapId))) throw new ExerciseGapNotInPlanError();

      const created = await exercises.createExercise(userId, {
        learningPlanId: body.learningPlanId,
        title: body.title,
        kind: body.kind,
        gapIds,
      });
      return toWire(created);
    },

    async updateStatus(userId, exerciseId, body) {
      // The completion gate (M3-03 D1). Only the `complete` target is gated;
      // order is 404 (exercise missing/foreign) BEFORE 409 (evidence), so a
      // foreign id never reveals another user's evidence state.
      if (body.status === 'complete') {
        const existing = await exercises.findExercise(userId, exerciseId);
        if (!existing) throw new ExerciseNotFoundError();
        const hasEvidence = await masteryEvidence.hasRequiredEvidence(userId, exerciseId);
        if (!hasEvidence) throw new ExerciseIncompleteEvidenceError();
      }
      const updated = await exercises.updateExerciseStatus(userId, exerciseId, body.status);
      if (!updated) throw new ExerciseNotFoundError();
      return toWire(updated);
    },

    async remove(userId, exerciseId) {
      const deleted = await exercises.deleteExercise(userId, exerciseId);
      if (!deleted) throw new ExerciseNotFoundError();
    },
  };
}
