import { CASE_STUDY_STATUSES, PROJECT_PROVENANCES } from '@careerforge/core';
import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { exercises } from './exercises.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M4-01: case_studies (Integrations & Hardening; ERD pre-registered in
// ARCHITECTURE §3). A case_study is a DETERMINISTICALLY-generated draft from a
// completed exercise (M3-02) + its mastery evidence (M3-03) — pure template
// assembly, NOT LLM-drafted (no run table, no citation tripwire; the M3-06
// class). The row is LOCAL bookkeeping; publishing is a MANUAL portfolio-content
// step outside this story (the module wall stands — nothing here writes into
// apps/portfolio/). Additive, forward-only (migration 0016): a new table with
// zero existing rows ⇒ no backfill ⇒ no hand-edit.
//
// LIFECYCLE: `draft` is regenerable — a repeat POST re-renders the snapshot
// while draft (OD-1, full-replacement). `published` is a ONE-WAY CAS flip
// (POST /:id/publish, OD-2) meaning "taken into the portfolio", which locks
// refresh. DELETE works at ANY status (OD-4): the row is local bookkeeping, so a
// mis-publish is recoverable via DELETE + re-POST — unlike append-only
// skill_upgrades or the paid-run audit resume_variants, this row guards nothing.
export const caseStudies = pgTable(
  'case_studies',
  {
    id: id(),
    // ADR-0007: every table carries user_id. CASCADE — a user delete removes
    // their drafts (local bookkeeping, no audit obligation).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Navigation FK to the source exercise. ON DELETE SET NULL (the M3-06
    // skill_upgrades precedent): a plan delete cascades exercises away, but the
    // draft + its snapshots must survive. The snapshot below (exercise_title)
    // and rendered_markdown are the durable record; this FK is navigation-only.
    // A NULLed row is unreachable by POST (its old exercise id 404s) but GET/
    // export/publish/DELETE still work on it by row id.
    exerciseId: uuid().references(() => exercises.id, { onDelete: 'set null' }),
    // Display snapshot of the source exercise title at generate time (survives
    // the FK NULL).
    exerciseTitle: text().notNull(),
    // The case-study title (defaults to exercise_title server-side when the POST
    // omits it; a refresh POST with an omitted title resets to exercise_title).
    title: text().notNull(),
    // The CHECK admits the FULL ERD vocabulary (professional included) — the
    // personal-only subset is enforced wire/service-side (OD-3), so a future
    // profile-project-sourced story needs no migration.
    provenance: text({ enum: PROJECT_PROVENANCES }).notNull(),
    status: text({ enum: CASE_STUDY_STATUSES }).notNull().default('draft'),
    // The rendered draft markdown, snapshotted at generate/refresh time — what
    // export serves byte-for-byte (the resume_variants.rendered_markdown
    // precedent). Born valid against the ADR-0010 portfolio honesty grammar.
    renderedMarkdown: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('case_studies_provenance_check', table.provenance, PROJECT_PROVENANCES),
    enumCheck('case_studies_status_check', table.status, CASE_STUDY_STATUSES),
    // ERD `exercises ||--o| case_studies` (zero-or-one) enforced. Nullable-column
    // unique: PG treats NULLs as distinct, so orphaned (exercise-deleted) rows
    // coexist and never block a fresh draft for a new exercise.
    uniqueIndex('case_studies_exercise_unique').on(table.exerciseId),
  ],
);
