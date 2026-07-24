import { z } from 'zod';

import { exerciseKindSchema, exerciseStatusSchema } from './enums.ts';

// Wire contracts for POST /exercises, PATCH /exercises/:id and DELETE
// /exercises/:id (M3-02). An exercise is a USER-AUTHORED action that belongs
// to one learning plan (M3-01) and links to the gaps it addresses — a
// deterministic CRUD artifact, NOT LLM-drafted (no run table, no citation
// tripwire). The gap links are STRUCTURAL (FK ids, never prose-parsed — the
// resume_variant_citations / learning_plan_gaps precedent). `title` is
// user-authored UNTRUSTED text: escaped on display, NUL-rejected at the
// boundary. `user_id` never crosses the wire.

/** Cost-free sanity cap on how many gaps a single exercise may cite. Well
 *  above any real exercise's gap set; the gap-membership 409 still fires
 *  BEFORE any write. No literal bound in the shipped schema. */
export const CREATE_EXERCISE_MAX_GAPS = 50;

/** Length bound on the user-authored `title`. Bounds the title where
 *  `learning_plans.title` is currently unbounded (that is model-drafted,
 *  `learning.ts` `z.string()`); precedent for the value is `postings.ts`
 *  `title: z.string().max(200)`. Paired with a NUL-reject below. */
export const EXERCISE_TITLE_MAX_CHARS = 200;

// A Postgres text column rejects U+0000 outright — reject at the boundary for
// a value-free 400 instead of a 500 (the postings.rawText / learning notes
// precedent). The guard uses the escaped U+0000 code unit, never a raw NUL
// byte (source-byte law).
const titleNoNul = (value: string) => !value.includes('\u0000');

/**
 * POST /exercises — create a user-authored exercise under one learning plan,
 * linked to a non-empty set of gaps that plan cites. `gapIds` duplicates are
 * collapsed at the service boundary. No `position`: it is SERVER-ASSIGNED
 * append order (there is no reorder surface; PATCH is status-only). No
 * `status`: a new exercise is always `planned`. Preconditions run in the
 * service before any write: plan owned/exists (404) → every gapId cited by
 * that plan (409 EXERCISE_GAP_NOT_IN_PLAN).
 */
export const createExerciseBodySchema = z.strictObject({
  learningPlanId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(EXERCISE_TITLE_MAX_CHARS)
    .refine(titleNoNul, 'must not contain U+0000'),
  kind: exerciseKindSchema,
  gapIds: z.array(z.uuid()).min(1).max(CREATE_EXERCISE_MAX_GAPS),
});
export type CreateExerciseBody = z.infer<typeof createExerciseBodySchema>;

/**
 * PATCH /exercises/:id — full replacement of the ONE mutable field (the
 * plan-items precedent: everything else is immutable by construction — the
 * repository UPDATE cannot touch title/kind/plan/links/position). A
 * mis-created exercise is recovered with DELETE, not a title/kind edit.
 */
export const exercisePatchBodySchema = z.strictObject({
  status: exerciseStatusSchema,
});
export type ExercisePatchBody = z.infer<typeof exercisePatchBodySchema>;

/**
 * One exercise on the wire, with its linked gap ids (structural citation).
 * `gapIds` are the gaps this exercise addresses, ascending; `position` is the
 * server-assigned append order within its plan. The shared shape returned by
 * POST and PATCH and embedded in GET /learning-plans/:id.
 */
export const exerciseSchema = z.strictObject({
  id: z.string(),
  learningPlanId: z.string(),
  title: z.string(),
  kind: exerciseKindSchema,
  status: exerciseStatusSchema,
  position: z.number().int().min(0),
  gapIds: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type Exercise = z.infer<typeof exerciseSchema>;

/** POST /exercises (201) and PATCH /exercises/:id (200) both return the one
 *  updated exercise — the row contract shared with the learning-plan embed so
 *  the caller re-renders in place. */
export const exerciseResponseSchema = exerciseSchema;
export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>;
