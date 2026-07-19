import {
  PLAN_DRAFTING_RUN_STATUSES,
  PLAN_ITEM_PRIORITIES,
  PLAN_ITEM_STATUSES,
  PLAN_REVIEW_STATUSES,
} from '@careerforge/core';
import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { fitReports } from './fit.ts';
import { gaps } from './gaps.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M1-12: improvement-plan artifacts (amended ERD, ARCHITECTURE §3). A plan
// is an LLM-DRAFTED, append-only artifact of exactly ONE fit report
// (pin-to-report; UNIQUE fit_report_id enforces the drawn ||--o|) and is
// draft-until-reviewed (ADR-0005 §3). The audit table mirrors
// extraction_runs column-for-column minus posting_id plus fit_report_id —
// one row per WIRE CALL (the M1-05 law at its second call site); the plan
// row is created only from an ok run (the extraction_runs ↔ requirements
// parallel).

export const improvementPlanRuns = pgTable(
  'improvement_plan_runs',
  {
    id: id(),
    // ADR-0007: every table carries user_id (5th application).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // CASCADE: raw_response embeds profile- and gap-derived text; every real
    // deletion origin (posting or extraction_run) reaches fit_reports and
    // must not strand audit rows quoting it (privacy-coherent, the
    // extraction_runs precedent).
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    // 'unknown' on thrown-error records — plain text, not an enum (the
    // extraction_runs precedent).
    model: text().notNull(),
    promptId: text().notNull(),
    // Full provider response, verbatim modulo real-U+0000 stripping (the
    // extraction_runs R1 rule). UNTRUSTED + PRIVATE: embeds profile and
    // posting-derived text; never logged, never on the wire.
    rawResponse: jsonb().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadInputTokens: integer().notNull(),
    cacheCreationInputTokens: integer().notNull(),
    latencyMs: integer().notNull(),
    // 1-based; 2 only on the schema-failure retry.
    attempt: integer().notNull(),
    // Runner sets ok|schema_failed|refusal|max_tokens|error; 'flagged' is
    // applied post-hoc by CITATION validation (a gap ref that was never
    // sent — the M1-06 layer-4 analog) and never by the runner.
    status: text({ enum: PLAN_DRAFTING_RUN_STATUSES }).notNull(),
    // created_at written explicitly from LlmCallRecord.timestamp (runner
    // clock, F3); defaultNow is only the bypass fallback.
    ...timestamps(),
  },
  (table) => [
    enumCheck('improvement_plan_runs_status_check', table.status, PLAN_DRAFTING_RUN_STATUSES),
  ],
);

export const improvementPlans = pgTable(
  'improvement_plans',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The pin-to-report anchor; UNIQUE below = the drawn ||--o| ("at most
    // one plan per report", the applications.posting_id precedent).
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    // Audit anchor: the ok wire call this plan was parsed from.
    draftingRunId: uuid()
      .notNull()
      .references(() => improvementPlanRuns.id, { onDelete: 'cascade' }),
    // Draft-until-reviewed workflow field (the fit_reports precedent);
    // content stays append-only.
    reviewStatus: text({ enum: PLAN_REVIEW_STATUSES }).notNull().default('draft'),
    // Review-note parity with fit_reports.notes; trimmed-or-null at the
    // service boundary, captured by the one-shot review CAS.
    notes: text(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('improvement_plans_review_status_check', table.reviewStatus, PLAN_REVIEW_STATUSES),
    uniqueIndex('improvement_plans_fit_report_id_unique').on(table.fitReportId),
  ],
);

export const planItems = pgTable(
  'plan_items',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Items are derived artifacts of their plan — they go with it.
    improvementPlanId: uuid()
      .notNull()
      .references(() => improvementPlans.id, { onDelete: 'cascade' }),
    // The citation (structural, FK — never prose-parsed). CASCADE is total:
    // gap rows only vanish via a cascade that removes this plan through its
    // own fit_report_id FK in the same statement (gate R1 both-route trace).
    // Many items may cite one gap (||--o{) — no unique on (plan, gap).
    gapId: uuid()
      .notNull()
      .references(() => gaps.id, { onDelete: 'cascade' }),
    // LLM-generated draft text — UNTRUSTED on display (RISKS S-02) and
    // immutable: the reviewed artifact is the model's cited draft, not an
    // edited one ('dropped' is the honest rejection path).
    action: text().notNull(),
    // Model-assigned; user-editable via the full-replacement PATCH.
    priority: text({ enum: PLAN_ITEM_PRIORITIES }).notNull(),
    status: text({ enum: PLAN_ITEM_STATUSES }).notNull().default('planned'),
    // Model output order; rows have no inherent order, reads sort by
    // (position, id) — the requirements.position precedent.
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('plan_items_priority_check', table.priority, PLAN_ITEM_PRIORITIES),
    enumCheck('plan_items_status_check', table.status, PLAN_ITEM_STATUSES),
  ],
);
