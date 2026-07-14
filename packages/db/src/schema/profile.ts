import { PROJECT_PROVENANCES, SKILL_LEVELS } from '@careerforge/core';
import { date, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

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
  (table) => [enumCheck('profile_skills_level_check', table.level, SKILL_LEVELS)],
);

export const profileExperiences = pgTable('profile_experiences', {
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
});

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
  ],
);

// One row per user (ERD ||--||); jsonb shapes mirror docs/profile.example/
// job-criteria.md and get zod schemas when the importer lands (M0-08).
export const searchCriteria = pgTable('search_criteria', {
  id: id(),
  userId: uuid()
    .notNull()
    .unique('search_criteria_user_id_unique')
    .references(() => users.id, { onDelete: 'cascade' }),
  hardFilters: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  positiveSignals: jsonb().$type<unknown[]>().notNull().default([]),
  negativeSignals: jsonb().$type<unknown[]>().notNull().default([]),
  compBounds: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
});
