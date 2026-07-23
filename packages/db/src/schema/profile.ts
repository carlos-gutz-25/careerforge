import {
  PROJECT_PROVENANCES,
  SKILL_LEVELS,
  type CompBounds,
  type ForceLowestPriority,
  type HardFilters,
  type NegativeSignals,
  type PositiveSignals,
} from '@careerforge/core';
import { sql } from 'drizzle-orm';
import { date, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

export const profileSkills = pgTable(
  'profile_skills',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    category: text(),
    level: text({ enum: SKILL_LEVELS }).notNull(),
    years: integer(),
    lastUsed: date(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('profile_skills_level_check', table.level, SKILL_LEVELS),
    // Natural key for M0-08's idempotent import (per-user, case-insensitive
    // so "TypeScript"/"typescript" can't duplicate).
    uniqueIndex('profile_skills_user_lower_name_unique').on(
      table.userId,
      sql`lower(${table.name})`,
    ),
  ],
);

export const profileExperiences = pgTable(
  'profile_experiences',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    company: text().notNull(),
    title: text().notNull(),
    startDate: date().notNull(),
    // NULL = current position.
    endDate: date(),
    ...timestamps(),
  },
  (table) => [
    // start_date keeps a boomerang rehire (same company + title, new stint)
    // representable while still giving the importer a stable upsert target.
    // lower() matches the skill/project keys: case-insensitivity is enforced
    // here, not just in the importer, so future writers can't duplicate
    // "Acme"/"acme" stints (migration 0002).
    uniqueIndex('profile_experiences_natural_key_unique').on(
      table.userId,
      sql`lower(${table.company})`,
      sql`lower(${table.title})`,
      table.startDate,
    ),
  ],
);

export const profileProjects = pgTable(
  'profile_projects',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: personal projects have no employer context. If an experience
    // is deleted its projects survive as personal-style orphans (SET NULL).
    experienceId: uuid().references(() => profileExperiences.id, { onDelete: 'set null' }),
    name: text().notNull(),
    provenance: text({ enum: PROJECT_PROVENANCES }).notNull(),
    summary: text(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('profile_projects_provenance_check', table.provenance, PROJECT_PROVENANCES),
    uniqueIndex('profile_projects_user_lower_name_unique').on(
      table.userId,
      sql`lower(${table.name})`,
    ),
  ],
);

// M2-12: the user's own verified experience bullets, captured from resume.md by
// the M0-08 importer (phase 2 of ADR-0012). Same trust class as project
// summaries — user-authored prose, NOT LLM- or posting-derived. Tailoring
// SELECTS / REORDERS / OMITS these true bullets (resume-tailoring@v2), never
// composes; the experience always renders even with every bullet deselected
// (the ADR-0012 honesty invariant — a job is never hidden). Bullets are
// intrinsic to their experience: ON DELETE CASCADE (contrast profile_projects'
// SET NULL — a project outlives its employer as a personal-style orphan, a
// bullet does not outlive its job). Ordered by `position` (source order), the
// idempotent-import upsert target.
export const profileExperienceBullets = pgTable(
  'profile_experience_bullets',
  {
    id: id(),
    // ADR-0007: every table carries user_id.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    experienceId: uuid()
      .notNull()
      .references(() => profileExperiences.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    // Source order; the natural key for the ordered-list sync (a reworded bullet
    // at a position is an update, trailing removed positions are deletes).
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    // experienceId already scopes to a user-owned experience, so user_id is
    // redundant in the key — (experienceId, position) is the render slot's
    // exactly-once law (the fit_sub_scores precedent).
    uniqueIndex('profile_experience_bullets_experience_position_unique').on(
      table.experienceId,
      table.position,
    ),
  ],
);

// One row per user (ERD ||--||). The jsonb payloads carry the canonical
// M1-08 criteria shapes (packages/core criteria schemas — the same zod
// contracts validate the importer's parse output, the PUT /criteria body,
// and these $types, so file, wire, and DB can never disagree).
// Column DEFAULTS are STRUCTURAL PLACEHOLDERS only: canonical validity
// (all five signal categories present, comp bounds populated, industry key
// present) is enforced at the write path, where every write passes the core
// schemas — application code never writes a defaulted row. The sql-literal
// defaults exist because a placeholder `{}` is deliberately NOT a valid
// value of the payload types.
export const searchCriteria = pgTable('search_criteria', {
  id: id(),
  userId: uuid()
    .notNull()
    .unique('search_criteria_user_id_unique')
    .references(() => users.id, { onDelete: 'cascade' }),
  hardFilters: jsonb().$type<HardFilters>().notNull().default({}),
  positiveSignals: jsonb()
    .$type<PositiveSignals>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  negativeSignals: jsonb().$type<NegativeSignals>().notNull().default([]),
  // A CAP to the bottom tier, never an exclusion (M1-08 semantics law) —
  // deliberately a sibling of hard_filters, not a key inside it.
  forceLowestPriority: jsonb()
    .$type<ForceLowestPriority>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  compBounds: jsonb()
    .$type<CompBounds>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  ...timestamps(),
});
