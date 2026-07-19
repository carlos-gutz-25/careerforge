import { GAP_CARRIED_VIA, GAP_CLASSIFICATIONS } from '@careerforge/core';
import { boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { requirements } from './extractions.ts';
import { fitReports } from './fit.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M1-11: gap classification artifacts (amended ERD, ARCHITECTURE §3).
// PER-REPORT, APPEND-ONLY gap sets (D1): every scoring run writes a fresh
// set in the SAME transaction as its fit report — a fit_reports row implies
// its complete gap set. The designed mutable exception: classification /
// user_overridden / override_note / carried_via are workflow fields (the
// review_status precedent); engine_classification and rationale are
// immutable engine output. Override carry-forward consults ONLY the
// posting's immediately prior report (A1 — an un-override can never be
// resurrected from older history), and all carry ordering reads
// created_at/id, never updated_at (R6: its $onUpdate bump is host-clock
// bookkeeping).

export const gaps = pgTable(
  'gaps',
  {
    id: id(),
    // ADR-0007: every table carries user_id (fit tables precedent).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Report-side anchor (the evidence_links lesson): re-scoring never
    // mingles gap sets. CASCADE with the report.
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    // CASCADE: rationale text embeds requirement/posting-derived vocabulary;
    // a posting deletion (postings -> runs -> requirements) must not strand
    // gap rows quoting it (privacy-coherent, extraction_runs precedent).
    requirementId: uuid()
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    // The EFFECTIVE value (engine or override).
    classification: text({ enum: GAP_CLASSIFICATIONS }).notNull(),
    // The engine's fresh assignment, immutable (D2) — diverging from
    // classification is the structured "engine now disagrees" signal.
    engineClassification: text({ enum: GAP_CLASSIFICATIONS }).notNull(),
    // Deterministic, rule-generated (never LLM) — the sub-score precedent.
    rationale: text().notNull(),
    userOverridden: boolean().notNull().default(false),
    // D3: an override records its why; trimmed-or-null at the service
    // boundary. Cleared on un-override and on every full-replacement PATCH
    // that omits it (A2).
    overrideNote: text(),
    // D5 carry audit: how an override arrived (requirement_id = re-score
    // carry, content = re-extraction one-to-one text carry); NULL = fresh
    // engine assignment or direct user PATCH.
    carriedVia: text({ enum: GAP_CARRIED_VIA }),
    ...timestamps(),
  },
  (table) => [
    enumCheck('gaps_classification_check', table.classification, GAP_CLASSIFICATIONS),
    enumCheck('gaps_engine_classification_check', table.engineClassification, GAP_CLASSIFICATIONS),
    // NULL passes an IN-list CHECK by SQL semantics — nullable by design.
    enumCheck('gaps_carried_via_check', table.carriedVia, GAP_CARRIED_VIA),
    // One classification per requirement per report (the fit_sub_scores
    // exactly-once law at the DB).
    uniqueIndex('gaps_report_requirement_unique').on(table.fitReportId, table.requirementId),
  ],
);
