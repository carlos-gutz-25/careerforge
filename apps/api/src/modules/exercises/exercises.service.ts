import { type CreateExerciseBody, type Exercise, type ExercisePatchBody } from '@careerforge/core';
import { type ExercisesRepository, type ExerciseWithGaps } from '@careerforge/db';

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

export function createExercisesService(deps: { exercises: ExercisesRepository }): ExercisesService {
  const { exercises } = deps;

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
