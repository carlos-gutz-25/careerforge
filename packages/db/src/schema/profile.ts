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
import { check, date, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

// M6-01: the deterministic resume header facts, parsed from resume.md's contact
// block (the region between the H1 and the first "## " section). These are
// user-authored, verbatim facts — the same trust class as experience bullets,
// NOT LLM- or posting-derived — that Resume Studio (M6-04+) composes a
// submittable header from. One row per user (ERD ||--||, the search_criteria
// precedent): the parser guarantees a full_name (missing H1 is a hard parse
// error), so a successful import always leaves exactly one contact row, and the
// sync upserts by user_id rather than deleting-and-reinserting.
//
// `links` holds the contact-block's non-tel/non-mailto markdown links as
// {label, url} in source order (LinkedIn today). It is parser-WRITTEN only in
// M6-01 — no read boundary exists yet; the FIRST consumer that reads it back
// across a boundary (M6-04's compose payload builder, or any later API
// exposure) OWES zod validation of the {label, url}[] shape at that boundary
// (the zod-at-every-boundary law; recorded in the M6-01 plan ADVISORY-B so it
// is not lost). Default is a sql-literal empty array (the search_criteria style).
export interface ProfileContactLink {
  label: string;
  url: string;
}

export const profileContact = pgTable('profile_contact', {
  id: id(),
  // One contact row per user: user_id itself is UNIQUE (the search_criteria
  // ||--|| precedent), not a composite key.
  userId: uuid()
    .notNull()
    .unique('profile_contact_user_id_unique')
    .references(() => users.id, { onDelete: 'cascade' }),
  fullName: text().notNull(),
  headline: text(),
  phone: text(),
  email: text(),
  location: text(),
  links: jsonb()
    .$type<ProfileContactLink[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  ...timestamps(),
});

// M6-01: the user's authored summary blocks (the "## Professional Summary"
// paragraphs), in source order. Compose (M6-04+) uses them as evidence input
// and honest fallback prose. Ordered by `position` (0-based source order), the
// ordered-list-sync natural key exactly like profile_experience_bullets — a
// reworded paragraph at a position is an update, a removed tail is a delete.
export const profileSummaries = pgTable(
  'profile_summaries',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('profile_summaries_user_position_unique').on(table.userId, table.position),
  ],
);

// M6-01: education entries from the "## Education" section, in source order.
// `credential` (the degree line) and the year range are nullable — a bare
// "### Institution" with no detail is a valid, if sparse, entry. The year-order
// CHECK is the 0017 cross-column precedent: any NULL side passes (a CHECK holds
// when its expression is NULL), so it constrains only fully-dated ranges.
export const profileEducation = pgTable(
  'profile_education',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    institution: text().notNull(),
    credential: text(),
    startYear: integer(),
    endYear: integer(),
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('profile_education_user_position_unique').on(table.userId, table.position),
    check(
      'profile_education_year_order_check',
      sql`${table.startYear} is null or ${table.endYear} is null or ${table.endYear} >= ${table.startYear}`,
    ),
  ],
);
