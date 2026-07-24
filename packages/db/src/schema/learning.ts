import {
  PLAN_DRAFTING_RUN_STATUSES,
  PLAN_ITEM_PRIORITIES,
  PLAN_REVIEW_STATUSES,
} from '@careerforge/core';
import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { gaps } from './gaps.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M3-01: learning-plan artifacts (Skill Accelerator; amended ERD,
// ARCHITECTURE §3). A learning plan is an LLM-DRAFTED, append-only artifact
// drafted over a USER-SELECTED set of gaps that may span MULTIPLE postings —
// UNLIKE an improvement plan (M1-12), which pins one-per-fit-report. There is
// no single report to pin to, so plans are FREE-CREATE (plural by design; no
// UNIQUE). If accidental double-charge ever needs preventing, the tool is a
// client idempotency key or debounce, never a schema UNIQUE (ADR-0013) — a
// UNIQUE would break plural-by-design. Draft-until-reviewed (ADR-0005 §3).

export const learningPlanRuns = pgTable(
  'learning_plan_runs',
  {
    id: id(),
    // ADR-0007: every table carries user_id (the improvement_plan_runs
    // precedent). This is the ONLY anchor a run carries — a learning plan has
    // no single source report, so (unlike improvement_plan_runs) there is no
    // fit_report_id column; the plan points to its ok run via drafting_run_id.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    // 'unknown' on thrown-error records — plain text, not an enum (the
    // extraction_runs precedent).
    model: text().notNull(),
    promptId: text().notNull(),
    // Full provider response, verbatim modulo real-U+0000 stripping (the
    // extraction_runs R1 rule). UNTRUSTED + PRIVATE: embeds profile- and
    // gap-derived text; never logged, never on the wire.
    rawResponse: jsonb().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadInputTokens: integer().notNull(),
    cacheCreationInputTokens: integer().notNull(),
    latencyMs: integer().notNull(),
    // 1-based; 2 only on the schema-failure retry.
    attempt: integer().notNull(),
    // Runner sets ok|schema_failed|refusal|max_tokens|error; 'flagged' is
    // applied post-hoc by CITATION validation (a gap ref that was never sent —
    // the M1-12 layer-4 analog) and never by the runner.
    status: text({ enum: PLAN_DRAFTING_RUN_STATUSES }).notNull(),
    // created_at written explicitly from LlmCallRecord.timestamp (runner
    // clock, F3); defaultNow is only the bypass fallback.
    ...timestamps(),
  },
  (table) => [
    enumCheck('learning_plan_runs_status_check', table.status, PLAN_DRAFTING_RUN_STATUSES),
  ],
);

export const learningPlans = pgTable(
  'learning_plans',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Model-drafted; user-editable later. UNTRUSTED on display (RISKS S-02).
    title: text().notNull(),
    // Audit anchor: the ok wire call this plan was parsed from (the
    // improvement_plans.draftingRunId precedent).
    draftingRunId: uuid()
      .notNull()
      .references(() => learningPlanRuns.id, { onDelete: 'cascade' }),
    // Draft-until-reviewed workflow field (the improvement_plans precedent);
    // content stays append-only.
    reviewStatus: text({ enum: PLAN_REVIEW_STATUSES }).notNull().default('draft'),
    // Review-note parity; trimmed-or-null at the service boundary, captured by
    // the one-shot review CAS.
    notes: text(),
    // NO uniqueIndex: free-create, plural by design (ADR-0013).
    ...timestamps(),
  },
  (table) => [
    enumCheck('learning_plans_review_status_check', table.reviewStatus, PLAN_REVIEW_STATUSES),
  ],
);

export const learningPlanGaps = pgTable(
  'learning_plan_gaps',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cited gaps go with their plan.
    learningPlanId: uuid()
      .notNull()
      .references(() => learningPlans.id, { onDelete: 'cascade' }),
    // The citation (structural, FK — never prose-parsed). Many-to-many
    // gaps<->plans (ERD:377): a gap may be cited by several plans, hence the
    // UNIQUE is per (plan, gap), not per gap. CASCADE: rationale/focus embeds
    // gap-derived vocabulary; a gap deletion (which only happens via a cascade
    // that removes the gap's fit_report) must not strand citing rows.
    gapId: uuid()
      .notNull()
      .references(() => gaps.id, { onDelete: 'cascade' }),
    // The model's drafted per-gap learning focus — UNTRUSTED on display (RISKS
    // S-02) and immutable: the reviewed artifact is the model's cited draft.
    focus: text().notNull(),
    // Model-assigned priority (reused PLAN_ITEM_PRIORITIES; no separate enum).
    priority: text({ enum: PLAN_ITEM_PRIORITIES }).notNull(),
    // Drafted order — recurring gaps first (higher seenInNPostings, a
    // SYNTACTIC recurrence: same normalizeWhitespace requirement text in >=2
    // distinct postings — M3-01 delta #4). Rows have no inherent order; reads
    // sort by (position, id) — the requirements.position precedent.
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('learning_plan_gaps_priority_check', table.priority, PLAN_ITEM_PRIORITIES),
    // One citation per gap per plan (the plan can't cite the same gap twice).
    uniqueIndex('learning_plan_gaps_plan_gap_unique').on(table.learningPlanId, table.gapId),
  ],
);
