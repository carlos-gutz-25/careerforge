import { computeRevisitState, type ReviewQueueResponse } from '@careerforge/core';
import { type ExerciseReviewRead, type MasteryEvidenceEmbedRead } from '@careerforge/db';

import { toLocalDateString } from '../../lib/local-date.ts';

// M3-05: the spaced review queue — a READ-ONLY projection over completed
// exercises (M3-02) and their `revisited` mastery evidence (M3-03), mapped
// through the pure core ladder (computeRevisitState). NO repository of its
// own and NO write surface: completing a revisit is the EXISTING
// POST /mastery-evidence with kind 'revisited'; this queue simply recomputes
// on the next GET. Deterministic date math, NOT LLM-drafted. Both injected
// reads are NARROW type-enforced views (the M3-03 pattern), so this module
// can never mutate exercises or evidence.

export interface ReviewQueueService {
  /** GET /review-queue — DUE revisits only, (dueOn asc, exerciseId asc). */
  getQueue(userId: string): Promise<ReviewQueueResponse>;
}

export function createReviewQueueService(deps: {
  exercises: ExerciseReviewRead;
  masteryEvidence: MasteryEvidenceEmbedRead;
  now?: () => number;
}): ReviewQueueService {
  const { exercises, masteryEvidence } = deps;
  const now = deps.now ?? (() => Date.now());

  return {
    async getQueue(userId) {
      const completed = await exercises.listCompletedExercises(userId);
      if (completed.length === 0) return { items: [] };
      // One batched evidence read (no N+1 — the D4 embed precedent); only
      // `revisited` rows feed the ladder.
      const evidenceByExercise = await masteryEvidence.listEvidenceByExerciseIds(
        userId,
        completed.map((exercise) => exercise.id),
      );
      const today = toLocalDateString(new Date(now()));

      const items = completed.flatMap((exercise) => {
        const revisitedDates = (evidenceByExercise.get(exercise.id) ?? [])
          .filter((row) => row.kind === 'revisited')
          .map((row) => row.recordedOn);
        const state = computeRevisitState({
          completedOn: exercise.completedOn,
          revisitedDates,
          today,
        });
        // Graduated exercises never appear; not-yet-due ones are simply not
        // listed (due-only is the spec floor — an "upcoming" preview would be
        // a pure additive filter later).
        if (state.graduated || !state.isDue) return [];
        return [
          {
            exerciseId: exercise.id,
            title: exercise.title,
            kind: exercise.kind,
            learningPlanId: exercise.learningPlanId,
            completedOn: exercise.completedOn,
            revisitCount: state.revisitCount,
            // Non-null whenever not graduated; the wire contract carries them
            // required.
            intervalDays: state.intervalDays as number,
            dueOn: state.dueOn as string,
          },
        ];
      });

      items.sort((a, b) =>
        a.dueOn === b.dueOn
          ? a.exerciseId.localeCompare(b.exerciseId)
          : a.dueOn.localeCompare(b.dueOn),
      );
      return { items };
    },
  };
}
