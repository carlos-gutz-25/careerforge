import {
  EXTRACTION_RUN_STATUSES,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_KINDS,
} from '@careerforge/core';
import { boolean, integer, jsonb, pgTable, real, text, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { enumCheck, id, timestamps } from './helpers.ts';
import { jobPostings } from './jobs.ts';

// M1-05: the extraction pipeline's audit + artifact tables (amended ERD,
// ARCHITECTURE §3). Append-only: re-extraction creates a new run; old runs,
// raw responses, and prompt ids are kept for audit and prompt-regression
// comparison. One row per WIRE CALL — a schema-failure retry produces two
// rows (attempt 1 schema_failed, attempt 2 final).

export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: id(),
    // user_id not in the ERD's extraction_runs block — added per ADR-0007
    // ("every table carries user_id"), same precedent as applications.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // CASCADE (not restrict): raw_response embeds posting text, so a posting
    // deletion must not leave that text behind in audit rows. Deletion is not
    // a feature today; this pins the privacy-coherent behavior if it becomes
    // one.
    postingId: uuid()
      .notNull()
      .references(() => jobPostings.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    // 'unknown' on thrown-error records (the runner never saw a response) —
    // deliberately a plain text column, not an enum.
    model: text().notNull(),
    promptId: text().notNull(),
    // Full provider response, verbatim (ADR-0005 §2: audit + replay), modulo
    // one sanitization: real U+0000 CHARACTERS are stripped from string
    // values and object keys — Postgres jsonb rejects them, and losing the
    // whole audit row to a NUL is worse. The literal 6-char escape TEXT
    // backslash-u-0000 survives byte-identical (external review R1).
    // UNTRUSTED: can embed posting text; never logged, never on the wire.
    rawResponse: jsonb().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadInputTokens: integer().notNull(),
    cacheCreationInputTokens: integer().notNull(),
    latencyMs: integer().notNull(),
    // 1-based; 2 only on the schema-failure retry.
    attempt: integer().notNull(),
    // Runner sets ok|schema_failed|refusal|max_tokens|error; 'flagged' is
    // applied post-hoc by evidence verification (M1-06), never by the runner.
    status: text({ enum: EXTRACTION_RUN_STATUSES }).notNull(),
    // created_at is written explicitly from LlmCallRecord.timestamp (the
    // runner's now-seam clock, external review F3) — defaultNow is only the
    // fallback for writes that bypass the repository.
    ...timestamps(),
  },
  (table) => [enumCheck('extraction_runs_status_check', table.status, EXTRACTION_RUN_STATUSES)],
);

export const requirements = pgTable(
  'requirements',
  {
    id: id(),
    // Same ADR-0007 addition as extraction_runs.user_id.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Requirements are derived artifacts of their run — they go with it.
    extractionRunId: uuid()
      .notNull()
      .references(() => extractionRuns.id, { onDelete: 'cascade' }),
    kind: text({ enum: REQUIREMENT_KINDS }).notNull(),
    category: text({ enum: REQUIREMENT_CATEGORIES }).notNull(),
    text: text().notNull(),
    // Verbatim excerpt from the posting (UNTRUSTED on display, like
    // raw_text); M1-06 string-matches it against the stored posting.
    sourceQuote: text().notNull(),
    // NULL until evidence verification (M1-06) runs; true/false after.
    quoteVerified: boolean(),
    confidence: real().notNull(),
    // Model output order (most significant first, per the prompt); rows have
    // no inherent order, reads sort by this. Not in the ERD — amended.
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('requirements_kind_check', table.kind, REQUIREMENT_KINDS),
    enumCheck('requirements_category_check', table.category, REQUIREMENT_CATEGORIES),
  ],
);
