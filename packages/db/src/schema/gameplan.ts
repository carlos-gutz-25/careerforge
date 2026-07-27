import {
  GAMEPLAN_CHECK_KEYS,
  GAMEPLAN_DRAFTING_RUN_STATUSES,
  GAMEPLAN_PHASES,
  PLAN_REVIEW_STATUSES,
} from '@careerforge/core';
import { boolean, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { evidenceLinks, fitReports } from './fit.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M7-05 (ADR-0019): application-gameplan artifacts. A gameplan is an LLM-DRAFTED,
// pin-to-report, posting-scoped artifact (the M3-04 interview-prep template) that
// turns a scored fit report into an apply/screen/interview/offer strategy plus
// STAR stories — and NEVER a sendable message. NEVER-SEND LAYER L1 (the strongest
// guarantee, ADR-0019): NONE of these six tables carries a message-shaped column
// (to/from/recipient/subject/body/message/email_address/salutation/signature) —
// every text column is strategy, reflection, or STAR-story content. You cannot
// send what the schema cannot hold. A structural test (gameplan-schema.test.ts)
// enforces this by construction.
//
// These tables are BORN UNUSED: M7-05 creates them with no repository and no
// route reading or writing them (the ADR-0017 / M7-02 "authored + tested, no
// runtime caller" posture). The repository + service + the two server tripwires
// (message-likeness via looksLikeOutreach, story-citation provenance) + their
// planted-FAIL detection proofs are M7-07. Every row is CASCADE-reachable from
// the fit report, so a posting or extraction-run deletion removes the whole
// artifact coherently (the interview-prep privacy-coherent-delete law). Every
// table carries user_id (ADR-0007). Length/count caps (<=600/<=300/<=6) are a
// zod-boundary concern (M7-06/M7-07), NOT DB CHECKs — the interview-prep split.

export const applicationGameplanRuns = pgTable(
  'application_gameplan_runs',
  {
    id: id(),
    // ADR-0007: every table carries user_id.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // CASCADE: raw_response embeds profile-, requirement- and posting-derived
    // text; every real deletion origin (posting or extraction_run) reaches
    // fit_reports and must not strand audit rows quoting it (the
    // interview_prep_runs precedent). Many runs per report — NO unique here.
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    // 'unknown' on thrown-error records — plain text, not an enum (the
    // extraction_runs precedent).
    model: text().notNull(),
    // The pin, e.g. application-gameplan@v1 — provenance of which prompt version
    // drafted this artifact (M7-06 mints the version).
    promptId: text().notNull(),
    // Full provider response, verbatim modulo real-U+0000 stripping. UNTRUSTED +
    // PRIVATE: embeds profile and posting-derived text; never logged, never on
    // the wire.
    rawResponse: jsonb().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadInputTokens: integer().notNull(),
    cacheCreationInputTokens: integer().notNull(),
    latencyMs: integer().notNull(),
    // 1-based; 2 only on the schema-failure retry.
    attempt: integer().notNull(),
    // Runner sets ok|schema_failed|refusal|max_tokens|error; 'flagged' is applied
    // post-hoc by the two M7-07 tripwires (message-likeness AND story-citation
    // provenance, plus any containsExternalPointer hit) and NEVER by the runner
    // (enforced by the repository's Exclude<...,'flagged'> insert type at M7-07).
    status: text({ enum: GAMEPLAN_DRAFTING_RUN_STATUSES }).notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck(
      'application_gameplan_runs_status_check',
      table.status,
      GAMEPLAN_DRAFTING_RUN_STATUSES,
    ),
  ],
);

export const applicationGameplans = pgTable(
  'application_gameplans',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The pin-to-report anchor; UNIQUE below = the drawn ||--o| ("at most one
    // gameplan per report" — regeneration is a re-draft, never an overwrite; the
    // M7-07 persist uses onConflictDoNothing(target: fitReportId) for race
    // safety, ADR-0019 consequence B: cache-once, not supersede).
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    // Audit anchor: the ok wire call this gameplan was parsed from.
    draftingRunId: uuid()
      .notNull()
      .references(() => applicationGameplanRuns.id, { onDelete: 'cascade' }),
    // The single <=600 scalar — one per gameplan, so it lives on this row, not a
    // child table. Length capped at the zod boundary (M7-06/M7-07), not here.
    strategySummary: text().notNull(),
    // Draft-until-reviewed workflow field (the interview_preps precedent);
    // content stays append-only, the one-shot review CAS is M7-07.
    reviewStatus: text({ enum: PLAN_REVIEW_STATUSES }).notNull().default('draft'),
    // Review-note parity with interview_preps.notes; trimmed-or-null at the
    // service boundary.
    notes: text(),
    ...timestamps(),
  },
  (table) => [
    enumCheck(
      'application_gameplans_review_status_check',
      table.reviewStatus,
      PLAN_REVIEW_STATUSES,
    ),
    uniqueIndex('application_gameplans_fit_report_id_unique').on(table.fitReportId),
  ],
);

export const gameplanPhaseStrategies = pgTable(
  'gameplan_phase_strategies',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Phase strategies are derived artifacts of their gameplan — they go with it.
    applicationGameplanId: uuid()
      .notNull()
      .references(() => applicationGameplans.id, { onDelete: 'cascade' }),
    // The artifact's OWN 4-value vocabulary apply|screen|interview|offer (D5) —
    // NOT APPLICATION_STAGES. No `position` column: phase order is the fixed
    // GAMEPLAN_PHASES order, read-sorted by the derivation index (a phase enum
    // has a canonical order; the interview `position` idiom is for free-count
    // children like stories, not a fixed 4-set).
    phase: text({ enum: GAMEPLAN_PHASES }).notNull(),
    // The <=600 phase strategy; length capped at the zod boundary, not here.
    strategy: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('gameplan_phase_strategies_phase_check', table.phase, GAMEPLAN_PHASES),
    // At most one strategy per phase per gameplan. "Exactly one per phase (all
    // four present)" is an M7-07 insert-time service invariant; the DB UNIQUE
    // guarantees no duplicates, the service guarantees completeness (the
    // interview-prep division of labor).
    uniqueIndex('gameplan_phase_strategies_gameplan_phase_unique').on(
      table.applicationGameplanId,
      table.phase,
    ),
  ],
);

export const gameplanStories = pgTable(
  'gameplan_stories',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Stories are derived artifacts of their gameplan — they go with it.
    applicationGameplanId: uuid()
      .notNull()
      .references(() => applicationGameplans.id, { onDelete: 'cascade' }),
    // The four STAR text columns (each <=300 at the zod boundary). These are
    // strategy/reflection content, NOT a message — layer L1 (no message-shaped
    // column exists anywhere in the artifact).
    situation: text().notNull(),
    task: text().notNull(),
    action: text().notNull(),
    result: text().notNull(),
    // Model output order; reads sort by (position, id) — the requirements.position
    // idiom. The 0..6 count is a zod/service cap, not a DB CHECK.
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('gameplan_stories_gameplan_position_unique').on(
      table.applicationGameplanId,
      table.position,
    ),
  ],
);

export const gameplanStoryCitations = pgTable(
  'gameplan_story_citations',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Citations are the story->evidence provenance ledger — they go with the
    // story. The durability spine.
    gameplanStoryId: uuid()
      .notNull()
      .references(() => gameplanStories.id, { onDelete: 'cascade' }),
    // The cited evidence (structural, FK — never prose-parsed). CASCADE because
    // evidence_links hang off fit_sub_scores under the same fit_report ancestor,
    // so both routes vanish in one statement (the interview_prep_points
    // evidence-FK precedent). NOT XOR-shaped: a story cites only evidence, so a
    // single non-null FK is correct — no implication-form CHECK is needed. The
    // ">=1 citation per story" and "belongs to a cited requirement" invariants
    // are M7-07 insert-time service checks (the story-citation tripwire, resolved
    // via the payload's evidence->requirement map — the DB cannot see "cited
    // requirement"), NOT a DB constraint.
    evidenceLinkId: uuid()
      .notNull()
      .references(() => evidenceLinks.id, { onDelete: 'cascade' }),
    // Model output order within the story; reads sort by (position, id).
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    // (story, position) for output-order fidelity; no-duplicate-evidence-per-story
    // is an M7-07 service invariant (interview-prep does not DB-dedupe points).
    uniqueIndex('gameplan_story_citations_story_position_unique').on(
      table.gameplanStoryId,
      table.position,
    ),
  ],
);

export const gameplanChecks = pgTable(
  'gameplan_checks',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Checks are per-gameplan toggle state — they go with the gameplan.
    applicationGameplanId: uuid()
      .notNull()
      .references(() => applicationGameplans.id, { onDelete: 'cascade' }),
    // A stable key naming which code-owned template item this toggle is for. The
    // closed key set is DERIVED from GAMEPLAN_CHECKLIST_TEMPLATES (core, D8), so
    // an unknown key cannot be inserted. ADR-0019 consequence A: because this set
    // is baked into the DDL CHECK, adding/renaming a template later is a
    // follow-up forward-only migration event.
    checkKey: text({ enum: GAMEPLAN_CHECK_KEYS }).notNull(),
    // A toggle is on/off; updatedAt already records the last change (a nullable
    // timestamp would conflate "unchecked" with "never touched", ADR-0019 D3.6).
    done: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    enumCheck('gameplan_checks_check_key_check', table.checkKey, GAMEPLAN_CHECK_KEYS),
    // One toggle row per (gameplan, template item). Population (eager-vs-lazy) is
    // M7-07's policy; M7-05 fixes only the shape.
    uniqueIndex('gameplan_checks_gameplan_key_unique').on(
      table.applicationGameplanId,
      table.checkKey,
    ),
  ],
);
