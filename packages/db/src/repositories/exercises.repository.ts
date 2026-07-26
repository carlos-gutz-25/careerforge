import { type ExerciseKind, type ExerciseStatus } from '@careerforge/core';
import { and, asc, eq, inArray, isNotNull, max } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { exerciseGaps, exercises } from '../schema/exercises.ts';
import { learningPlanGaps, learningPlans } from '../schema/learning.ts';

// M3-02: exercise persistence + reads. An exercise is a USER-AUTHORED action
// under one learning plan (M3-01), linked to the gaps it addresses — plain
// CRUD, no LLM run table. The ONLY module allowed SQL (routes -> services ->
// repositories). Every query is user-scoped (ADR-0007). `position` is
// SERVER-ASSIGNED append order, computed inside the create transaction.

export type ExerciseRow = typeof exercises.$inferSelect;

/** An exercise row with the ids of the gaps it addresses (ascending). The
 *  shared read shape behind POST/PATCH responses and the GET /learning-plans
 *  embed. */
export interface ExerciseWithGaps {
  row: ExerciseRow;
  gapIds: string[];
}

/** The create input the service assembles after its preconditions pass;
 *  `gapIds` is already validated (owned, plan-cited) and de-duplicated. */
export interface CreateExerciseInput {
  learningPlanId: string;
  title: string;
  kind: ExerciseKind;
  gapIds: string[];
}

export interface ExercisesRepository {
  /**
   * The gap ids a learning plan cites (from learning_plan_gaps), for the
   * membership precondition. `undefined` = the plan is missing or foreign (the
   * one 404 outcome); an empty array = the plan exists but cites no gaps.
   * Distinguishing the two is why this is not just a gap-id select.
   */
  findPlanCitedGapIds(userId: string, planId: string): Promise<string[] | undefined>;

  /** One transaction: assign next-in-plan position, insert the exercise, then
   *  its gap links. Returns the created exercise with its gap ids. Assumes the
   *  service has already validated ownership + membership. */
  createExercise(userId: string, input: CreateExerciseInput): Promise<ExerciseWithGaps>;

  /** One exercise (owner-scoped) with its gap ids, or undefined (404). */
  findExercise(userId: string, exerciseId: string): Promise<ExerciseWithGaps | undefined>;

  /** Full-replacement of the TWO mutable fields — status and its paired
   *  completion date (SERVICE-computed: stamped on the transition into
   *  `complete`, preserved on complete→complete, null otherwise; the
   *  exercises_completed_on_check CHECK enforces the pairing). Conditional
   *  UPDATE pinned to (user, id); undefined on zero rows = missing/foreign
   *  (404). Nothing else is touched — title/kind/plan/links/position are
   *  immutable here. */
  updateExerciseStatus(
    userId: string,
    exerciseId: string,
    status: ExerciseStatus,
    completedOn: string | null,
  ): Promise<ExerciseWithGaps | undefined>;

  /** Owner-scoped hard delete (the mis-create recourse); CASCADE clears its
   *  exercise_gaps rows. Returns true iff a row was deleted (false = 404). */
  deleteExercise(userId: string, exerciseId: string): Promise<boolean>;

  /** A plan's exercises with their gap ids, in (position, id) order — the GET
   *  /learning-plans/:id embed. */
  listExercisesByPlan(userId: string, planId: string): Promise<ExerciseWithGaps[]>;

  /** Every completed exercise of this user (across plans), id order — the
   *  GET /review-queue read (M3-05). `completed_on IS NOT NULL` is implied by
   *  the CHECK but stated in the WHERE so the narrowed non-null type is honest
   *  even against pre-CHECK data. */
  listCompletedExercises(userId: string): Promise<CompletedExercise[]>;

  /** Gap ids for a set of exercises, grouped by exercise id (ascending). The
   *  M3-06 upgrade-suggestion read — the exercise -> gap -> requirement bridge
   *  the deterministic matcher walks. Empty map for an empty id list. */
  gapIdsByExercise(userId: string, exerciseIds: string[]): Promise<Map<string, string[]>>;
}

/** The review-queue read shape: the display fields plus the ladder anchor.
 *  No gap ids (the queue does not render citations). */
export interface CompletedExercise {
  id: string;
  title: string;
  kind: ExerciseKind;
  learningPlanId: string;
  completedOn: string;
}

/** Narrow read-only view of the exercises repo for the mastery-evidence service
 *  (M3-03): the ONE read it needs — existence/ownership (undefined = 404) and,
 *  via `row.status`, the exercise's status for the D2 delete-guard. Injected as
 *  this interface, not the whole repository, so the cross-module handle is
 *  read-only by type. */
export type ExerciseOwnershipRead = Pick<ExercisesRepository, 'findExercise'>;

/** Narrow read-only view for the review-queue service (M3-05): the ONE read
 *  it needs. Injected as this interface, not the whole repository, so the
 *  cross-module handle is read-only by type (the ExerciseOwnershipRead /
 *  MasteryEvidenceEmbedRead precedent). */
export type ExerciseReviewRead = Pick<ExercisesRepository, 'listCompletedExercises'>;

/** Narrow read-only view for the M3-06 skill-upgrades module: completed
 *  exercises (GET suggestions), one exercise's ownership/status (POST
 *  re-derivation), and the exercise->gap bridge. Read-only by type. */
export type ExerciseUpgradeRead = Pick<
  ExercisesRepository,
  'listCompletedExercises' | 'findExercise' | 'gapIdsByExercise'
>;

/** Narrow read-only view for the M4-01 case-studies module: the ONE read it
 *  needs — one exercise's ownership/status + gap ids (POST re-derivation, zero
 *  client trust). Injected as this interface, not the whole repository, so the
 *  cross-module handle is read-only by type (the ExerciseUpgradeRead
 *  precedent). */
export type ExerciseCaseStudyRead = Pick<ExercisesRepository, 'findExercise'>;

export function createExercisesRepository(db: Db): ExercisesRepository {
  /** Gap ids for a set of exercises, grouped by exercise id (ascending). */
  async function gapIdsByExercise(
    userId: string,
    exerciseIds: string[],
  ): Promise<Map<string, string[]>> {
    const grouped = new Map<string, string[]>();
    if (exerciseIds.length === 0) return grouped;
    const links = await db
      .select({ exerciseId: exerciseGaps.exerciseId, gapId: exerciseGaps.gapId })
      .from(exerciseGaps)
      .where(and(eq(exerciseGaps.userId, userId), inArray(exerciseGaps.exerciseId, exerciseIds)))
      .orderBy(asc(exerciseGaps.gapId));
    for (const link of links) {
      const list = grouped.get(link.exerciseId);
      if (list) list.push(link.gapId);
      else grouped.set(link.exerciseId, [link.gapId]);
    }
    return grouped;
  }

  return {
    gapIdsByExercise,
    async findPlanCitedGapIds(userId, planId) {
      // A cross-module read of the plan's cited gaps. Kept here (not the
      // learning repo) so the exercises SERVICE has a single dependency; the
      // learning_plan_gaps table is imported directly.
      const [plan] = await db
        .select({ id: learningPlans.id })
        .from(learningPlans)
        .where(and(eq(learningPlans.userId, userId), eq(learningPlans.id, planId)))
        .limit(1);
      if (!plan) return undefined;
      const rows = await db
        .select({ gapId: learningPlanGaps.gapId })
        .from(learningPlanGaps)
        .where(
          and(eq(learningPlanGaps.userId, userId), eq(learningPlanGaps.learningPlanId, planId)),
        );
      return rows.map((row) => row.gapId);
    },

    async createExercise(userId, input) {
      return db.transaction(async (tx) => {
        const [agg] = await tx
          .select({ maxPos: max(exercises.position) })
          .from(exercises)
          .where(
            and(eq(exercises.userId, userId), eq(exercises.learningPlanId, input.learningPlanId)),
          );
        const position = Number(agg?.maxPos ?? -1) + 1;

        const [row] = await tx
          .insert(exercises)
          .values({
            userId,
            learningPlanId: input.learningPlanId,
            title: input.title,
            kind: input.kind,
            position,
          })
          .returning();
        if (!row) throw new Error('exercises insert returned no rows');

        if (input.gapIds.length > 0) {
          await tx
            .insert(exerciseGaps)
            .values(input.gapIds.map((gapId) => ({ userId, exerciseId: row.id, gapId })));
        }
        return { row, gapIds: [...input.gapIds].sort() };
      });
    },

    async findExercise(userId, exerciseId) {
      const [row] = await db
        .select()
        .from(exercises)
        .where(and(eq(exercises.userId, userId), eq(exercises.id, exerciseId)))
        .limit(1);
      if (!row) return undefined;
      const grouped = await gapIdsByExercise(userId, [row.id]);
      return { row, gapIds: grouped.get(row.id) ?? [] };
    },

    async updateExerciseStatus(userId, exerciseId, status, completedOn) {
      const [row] = await db
        .update(exercises)
        .set({ status, completedOn })
        .where(and(eq(exercises.userId, userId), eq(exercises.id, exerciseId)))
        .returning();
      if (!row) return undefined;
      const grouped = await gapIdsByExercise(userId, [row.id]);
      return { row, gapIds: grouped.get(row.id) ?? [] };
    },

    async deleteExercise(userId, exerciseId) {
      const deleted = await db
        .delete(exercises)
        .where(and(eq(exercises.userId, userId), eq(exercises.id, exerciseId)))
        .returning({ id: exercises.id });
      return deleted.length > 0;
    },

    async listCompletedExercises(userId) {
      const rows = await db
        .select({
          id: exercises.id,
          title: exercises.title,
          kind: exercises.kind,
          learningPlanId: exercises.learningPlanId,
          completedOn: exercises.completedOn,
        })
        .from(exercises)
        .where(
          and(
            eq(exercises.userId, userId),
            eq(exercises.status, 'complete'),
            isNotNull(exercises.completedOn),
          ),
        )
        .orderBy(asc(exercises.id));
      // completedOn is non-null by the WHERE; narrow the inferred nullable type.
      return rows.map((row) => ({ ...row, completedOn: row.completedOn as string }));
    },

    async listExercisesByPlan(userId, planId) {
      const rows = await db
        .select()
        .from(exercises)
        .where(and(eq(exercises.userId, userId), eq(exercises.learningPlanId, planId)))
        .orderBy(asc(exercises.position), asc(exercises.id));
      const grouped = await gapIdsByExercise(
        userId,
        rows.map((row) => row.id),
      );
      return rows.map((row) => ({ row, gapIds: grouped.get(row.id) ?? [] }));
    },
  };
}
