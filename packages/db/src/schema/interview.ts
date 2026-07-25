import {
  INTERVIEW_POINT_TYPES,
  INTERVIEW_QUESTION_KINDS,
  PLAN_DRAFTING_RUN_STATUSES,
  PLAN_REVIEW_STATUSES,
} from '@careerforge/core';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { requirements } from './extractions.ts';
import { evidenceLinks, fitReports } from './fit.ts';
import { gaps } from './gaps.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M3-04: interview-prep artifacts (ARCHITECTURE §3 addendum). A prep is an
// LLM-DRAFTED, append-only artifact of exactly ONE fit report
// (pin-to-report; UNIQUE fit_report_id enforces the drawn ||--o| — the
// M1-12 pattern, NOT ADR-0013's free-create) and is draft-until-reviewed
// (ADR-0005 §3). The audit table mirrors improvement_plan_runs
// column-for-column — one row per WIRE CALL (the M1-05 law at its fourth
// call site); the prep row is created only from an ok, tripwire-clean run.
// Every row here is CASCADE-reachable from the fit report, so a posting or
// extraction-run deletion removes the whole artifact coherently
// (privacy-coherent deletes).

export const interviewPrepRuns = pgTable(
  'interview_prep_runs',
  {
    id: id(),
    // ADR-0007: every table carries user_id.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // CASCADE: raw_response embeds profile-, gap- and requirement-derived
    // text; every real deletion origin (posting or extraction_run) reaches
    // fit_reports and must not strand audit rows quoting it (the
    // improvement_plan_runs precedent).
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
    // applied post-hoc by the two M3-04 tripwires — citation validation (a
    // requirement/evidence ref never sent, or evidence bled across
    // requirements) and DISCLOSURE validation (a question on a
    // disclosure-obliged gapped requirement with no gap_disclosure point) —
    // and never by the runner.
    status: text({ enum: PLAN_DRAFTING_RUN_STATUSES }).notNull(),
    // created_at written explicitly from LlmCallRecord.timestamp (runner
    // clock, F3); defaultNow is only the bypass fallback.
    ...timestamps(),
  },
  (table) => [
    enumCheck('interview_prep_runs_status_check', table.status, PLAN_DRAFTING_RUN_STATUSES),
  ],
);

export const interviewPreps = pgTable(
  'interview_preps',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The pin-to-report anchor; UNIQUE below = the drawn ||--o| ("at most
    // one prep per report" — regeneration is a re-score, never an overwrite).
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    // Audit anchor: the ok wire call this prep was parsed from.
    draftingRunId: uuid()
      .notNull()
      .references(() => interviewPrepRuns.id, { onDelete: 'cascade' }),
    // Draft-until-reviewed workflow field (the fit_reports precedent);
    // content stays append-only.
    reviewStatus: text({ enum: PLAN_REVIEW_STATUSES }).notNull().default('draft'),
    // Review-note parity with improvement_plans.notes; trimmed-or-null at
    // the service boundary, captured by the one-shot review CAS.
    notes: text(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('interview_preps_review_status_check', table.reviewStatus, PLAN_REVIEW_STATUSES),
    uniqueIndex('interview_preps_fit_report_id_unique').on(table.fitReportId),
  ],
);

export const interviewPrepQuestions = pgTable(
  'interview_prep_questions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Questions are derived artifacts of their prep — they go with it.
    interviewPrepId: uuid()
      .notNull()
      .references(() => interviewPreps.id, { onDelete: 'cascade' }),
    // The citation (structural, FK — never prose-parsed): the SENT,
    // quote-verified requirement this question targets. A fabricated ref
    // flags the run and never reaches this table. CASCADE is total:
    // requirement rows only vanish via an extraction-run cascade that
    // removes this prep through its report's own extraction_run_id in the
    // same statement (the plan_items gate-R1 both-route trace).
    requirementId: uuid()
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    kind: text({ enum: INTERVIEW_QUESTION_KINDS }).notNull(),
    // LLM-generated draft text — UNTRUSTED on display (RISKS S-02) and
    // immutable: the reviewed artifact is the model's cited draft, not an
    // edited one.
    question: text().notNull(),
    // Model output order; rows have no inherent order, reads sort by
    // (position, id) — the requirements.position precedent.
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('interview_prep_questions_kind_check', table.kind, INTERVIEW_QUESTION_KINDS),
  ],
);

export const interviewPrepPoints = pgTable(
  'interview_prep_points',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Points are derived artifacts of their question — they go with it.
    interviewPrepQuestionId: uuid()
      .notNull()
      .references(() => interviewPrepQuestions.id, { onDelete: 'cascade' }),
    type: text({ enum: INTERVIEW_POINT_TYPES }).notNull(),
    // The evidence citation (structural, FK): set iff type='evidence'. The
    // link belongs to this question's requirement (tripwire-validated before
    // the write). CASCADE: evidence_links hang off fit_sub_scores under the
    // same fit_report ancestor, so both routes vanish in one statement.
    evidenceLinkId: uuid().references(() => evidenceLinks.id, { onDelete: 'cascade' }),
    // The disclosed gap (structural, FK): set iff type='gap_disclosure',
    // resolved SERVER-SIDE from the question's requirement (gaps are 1:0..1
    // per (report, requirement); the model never addresses a gap directly —
    // zero fabrication surface). Same shared-ancestor CASCADE as above.
    gapId: uuid().references(() => gaps.id, { onDelete: 'cascade' }),
    // LLM-generated draft text — UNTRUSTED on display (RISKS S-02),
    // immutable. For disclosures it is SUPPLEMENTARY prose: the badge the UI
    // renders comes from the gap row's live classification at read time,
    // never from this text (M3-04 gate condition 3).
    text: text().notNull(),
    // Model output order within the question; reads sort by (position, id).
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('interview_prep_points_type_check', table.type, INTERVIEW_POINT_TYPES),
    // Per-type FK-nullness, implication form: exactly the FK matching the
    // type is set and the other is pinned NULL — the
    // resume_variant_entries_section_fk_check precedent (resume.ts), with
    // NOT-NULL added on the matching side (a point without its citation is
    // malformed, unlike a SET-NULL profile pointer).
    check(
      'interview_prep_points_type_fk_check',
      sql`(${table.type} <> 'evidence' or (${table.evidenceLinkId} is not null and ${table.gapId} is null))
        and (${table.type} <> 'gap_disclosure' or (${table.gapId} is not null and ${table.evidenceLinkId} is null))`,
    ),
  ],
);
