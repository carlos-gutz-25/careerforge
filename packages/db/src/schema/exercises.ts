import { EXERCISE_KINDS, EXERCISE_STATUSES } from '@careerforge/core';
import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { gaps } from './gaps.ts';
import { enumCheck, id, timestamps } from './helpers.ts';
import { learningPlans } from './learning.ts';

// M3-02: exercises + the exercise<->gap join (Skill Accelerator; amended ERD,
// ARCHITECTURE §3). An exercise is a USER-AUTHORED action that belongs to one
// learning plan (M3-01) and links to the gaps it addresses — deterministic
// CRUD, NOT LLM-drafted (no run table, no citation tripwire). Additive,
// forward-only (migration 0011).

export const exercises = pgTable(
  'exercises',
  {
    id: id(),
    // ADR-0007: every table carries user_id (the learning_plan_gaps
    // precedent).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // An exercise is a child of exactly one plan; CASCADE — deleting the plan
    // removes its exercises (the derived-artifact family).
    learningPlanId: uuid()
      .notNull()
      .references(() => learningPlans.id, { onDelete: 'cascade' }),
    // User-authored; UNTRUSTED on display (escaped, RISKS S-02). Bounded +
    // NUL-rejected at the wire boundary (core exercises.ts).
    title: text().notNull(),
    // Immutable after create (a mis-created exercise is DELETEd, not edited).
    kind: text({ enum: EXERCISE_KINDS }).notNull(),
    // Lifecycle; the only field a PATCH may change. No `dropped` (that is the
    // LLM plan-item's state — EXERCISE_STATUSES omits it by decision).
    status: text({ enum: EXERCISE_STATUSES }).notNull().default('planned'),
    // SERVER-ASSIGNED append order within the plan — no client-supplied
    // position, no reorder surface (PATCH is status-only). The repository
    // assigns next-in-plan on insert; reads sort by (position, id) — the
    // requirements.position / learning_plan_gaps.position precedent.
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('exercises_kind_check', table.kind, EXERCISE_KINDS),
    enumCheck('exercises_status_check', table.status, EXERCISE_STATUSES),
  ],
);

export const exerciseGaps = pgTable(
  'exercise_gaps',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The exercise this link belongs to; CASCADE — deleting the exercise (the
    // mis-create recourse) clears its links.
    exerciseId: uuid()
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    // The citation (structural, FK — never prose-parsed; the
    // learning_plan_gaps.gap_id / resume_variant_citations.gap_id precedent).
    // CASCADE: a gap deletion (which only happens via a cascade removing the
    // gap's fit_report) must not strand link rows.
    //
    // MEMBERSHIP is a SERVICE precondition, not a schema FK: a POST must cite
    // only gaps the exercise's plan already cites (409 EXERCISE_GAP_NOT_IN_PLAN,
    // ADR-0013's service-enforced-precondition precedent). This is sufficient
    // ONLY because no "un-cite a gap from a plan" mutation exists today.
    // RESIDUAL TRIGGER: if a future story ever removes a gap from a plan
    // WITHOUT deleting the gap, this join needs a companion cleanup pass (prune
    // now-invalid exercise_gaps rows) OR a migration to a learning_plan_gaps
    // join-row FK (which would make membership structural).
    gapId: uuid()
      .notNull()
      .references(() => gaps.id, { onDelete: 'cascade' }),
    ...timestamps(),
  },
  (table) => [
    // One link per gap per exercise (an exercise can't cite the same gap
    // twice); the (exercise, gap) natural key.
    uniqueIndex('exercise_gaps_exercise_gap_unique').on(table.exerciseId, table.gapId),
  ],
);
