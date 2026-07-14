import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_STAGES,
  JOB_POSTING_STATUSES,
} from '@careerforge/core';
import { date, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

export const jobPostings = pgTable(
  'job_postings',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // UNTRUSTED input (CLAUDE.md hard rule): pasted posting text. Escaped at
    // display, never rendered as HTML/markdown, never in an LLM system prompt.
    rawText: text().notNull(),
    contentHash: text().notNull(),
    company: text(),
    title: text(),
    sourceNote: text(),
    status: text({ enum: JOB_POSTING_STATUSES }).notNull().default('new'),
    ...timestamps(),
  },
  (table) => [
    // Dedupe boundary (ERD "content_hash — dedupe"): same pasted text twice
    // for the same user is rejected, not duplicated.
    unique('job_postings_user_id_content_hash_unique').on(table.userId, table.contentHash),
    enumCheck('job_postings_status_check', table.status, JOB_POSTING_STATUSES),
  ],
);

export const applications = pgTable(
  'applications',
  {
    id: id(),
    // user_id not in the ERD's applications block — added per ADR-0007
    // ("every table carries user_id"), ratified 2026-07-13; ERD amended.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // UNIQUE per ERD ||--o| (at most one application per posting). RESTRICT is
    // intentional: postings with an application are archived, never deleted.
    postingId: uuid()
      .notNull()
      .unique('applications_posting_id_unique')
      .references(() => jobPostings.id, { onDelete: 'restrict' }),
    stage: text({ enum: APPLICATION_STAGES }).notNull().default('considering'),
    appliedOn: date(),
    ...timestamps(),
  },
  (table) => [enumCheck('applications_stage_check', table.stage, APPLICATION_STAGES)],
);

export const applicationEvents = pgTable(
  'application_events',
  {
    id: id(),
    // Same ADR-0007 addition as applications.user_id.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: uuid()
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    kind: text({ enum: APPLICATION_EVENT_KINDS }).notNull(),
    detail: text(),
    occurredOn: date().notNull(),
    ...timestamps(),
  },
  (table) => [enumCheck('application_events_kind_check', table.kind, APPLICATION_EVENT_KINDS)],
);
