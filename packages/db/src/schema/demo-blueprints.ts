import { type MarketSignalRef, type RequirementCategory } from '@careerforge/core';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { gaps } from './gaps.ts';
import { id, timestamps } from './helpers.ts';
import { users } from './auth.ts';

// M9-04 (V2-PLAN 3.5): demo_blueprints - deterministic template scaffolding for
// the market signal's BUILD recommendations (problem / constraints / deliverables
// / evidence-required), linked to exercises via gaps.id. A blueprint is a durable
// working brief the user executes against across sessions - pure template assembly
// from COUNTS the service derived from the user's own saved postings, NOT
// LLM-drafted (no run table, no citation tripwire; the M4-01 case_studies class).
// The row is LOCAL bookkeeping; nothing here writes into apps/portfolio/ or mints
// exercises (the module wall stands - "linked to exercises" is a READ). Additive,
// forward-only (migration 0022): a new table with zero existing rows => no
// backfill, no hand-edit.
//
// SNAPSHOT + REFRESH (D1/D4): the market signal is recomputed per request and
// legitimately shifts under new postings/re-scores; a computed-on-demand blueprint
// would silently rewrite the user's brief under them. So every count/section/refs
// is snapshotted at generate/refresh time (the case_studies rendered-snapshot
// rationale); scorer_version is the per-row reproducibility anchor. A repeat POST
// for the same skill group is a FULL-REPLACEMENT refresh in place (same row id);
// DELETE works at any time (local bookkeeping guards nothing).
//
// IDENTITY (D4): group_key is the M9-02 recurrence key normalizeWhitespace(
// requirementText) of the anchor's group, COPIED from the group (never recomputed
// here). requirements.text is UNBOUNDED on the wire (core extractions.ts) and
// posting-derived, so a hostile posting can mint a group_key past the btree ~2.7KB
// limit; the unique key is therefore the md5 (group_key_hash, a GENERATED STORED
// column), and the raw group_key column stays as the readable identity. md5 is used
// for IDENTITY dedupe, not security (R7).
//
// PRIVACY-COHERENCE DEVIATION (audit REQUIRED-1 / R9) - NAMED HERE BY DESIGN:
// the repo's test-pinned convention (constraints.test.ts "privacy-coherent delete")
// is that posting-derived artifacts CASCADE away with their posting - fit_reports ->
// sub-scores -> evidence links -> gaps, interview preps, gameplans all vanish when
// their posting is deleted. demo_blueprints DELIBERATELY DEVIATES from that
// convention: it is the FIRST table where posting-derived text (requirement_text,
// group_key, and the posting/report ids inside refs) SURVIVES the deletion of every
// posting that carried it. There is no posting FK, and the gap FK is ON DELETE SET
// NULL (navigation only). This is a decision, not an accident: a blueprint is a
// CROSS-POSTING user artifact - the working brief belongs to the USER, not to any
// single posting, and deleting a posting is not brief-revocation. The user's
// recourses are DELETE (drops the brief and its snapshot entirely) and refresh
// (re-snapshots from the current signal, shedding dead refs). The surviving text is
// never republished (module walls; it never enters logs or the portfolio). The
// survival behavior is pinned by an integration test (delete the LAST posting behind
// a blueprint -> the row + GET survive with gap_id NULL).
export const demoBlueprints = pgTable(
  'demo_blueprints',
  {
    id: id(),
    // ADR-0007: every table carries user_id. CASCADE - a user delete removes
    // their blueprints (local bookkeeping, no audit obligation).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Navigation FK to the anchor gap. ON DELETE SET NULL (the case_studies
    // exercise_id precedent): a re-score/posting delete cascades the gap away, but
    // the blueprint + its snapshot must survive (the durable record is the columns
    // below). A NULLed row is unreachable by a re-anchoring POST via that old gap
    // id, but GET/DELETE still work on it by row id.
    gapId: uuid().references(() => gaps.id, { onDelete: 'set null' }),
    // The M9-02 recurrence key normalizeWhitespace(requirementText) of the anchor's
    // group - copied from the group, never recomputed here. Readable identity.
    groupKey: text('group_key').notNull(),
    // GENERATED md5(group_key) - the adversarial-length-safe unique key (the raw
    // key is wire-unbounded and posting-derived; see the IDENTITY note). If
    // drizzle-kit cannot emit the generated column cleanly, the repository computes
    // this on insert/update instead (the D4 fallback; single write path).
    groupKeyHash: text('group_key_hash')
      .notNull()
      .generatedAlwaysAs(sql`md5(group_key)`),
    // The group's displayText snapshot - UNTRUSTED posting-derived display DATA
    // (escaped by consumers, never rendered as HTML/markdown; never in logs).
    requirementText: text('requirement_text').notNull(),
    // Blueprint title (defaults to normalizeWhitespace(requirementText) truncated,
    // server-side, when the POST omits it; a refresh POST with an omitted title
    // resets to that default). Display DATA like requirement_text.
    title: text().notNull(),
    // The MARKET_SIGNAL_SCORER_VERSION at generate time - the reproducibility
    // anchor (nothing recomputes this row after snapshot).
    scorerVersion: integer('scorer_version').notNull(),
    // Snapshotted group counts (the scaffolder's only numeric inputs).
    postingCount: integer('posting_count').notNull(),
    instanceCount: integer('instance_count').notNull(),
    mustHavePostingCount: integer('must_have_posting_count').notNull(),
    niceToHavePostingCount: integer('nice_to_have_posting_count').notNull(),
    // The group's distinct requirement categories, sorted (enum tokens only).
    categories: jsonb().notNull().$type<RequirementCategory[]>(),
    // The group's full refs[] at generate time - provenance + the D5 linkage source
    // (gap ids the linked-exercises read joins on). Posting/report ids inside here
    // are the posting-derived text that survives a posting delete (see R9).
    refs: jsonb().notNull().$type<MarketSignalRef[]>(),
    // The four scaffolded section texts, snapshotted. Template constants + the
    // input counts ONLY - no posting-derived text is ever interpolated (D3).
    problem: text().notNull(),
    constraints: text().notNull(),
    deliverables: text().notNull(),
    evidenceRequired: text('evidence_required').notNull(),
    ...timestamps(),
  },
  (table) => [
    // A signal group always has at least one demanding posting.
    check('demo_blueprints_posting_count_check', sql`${table.postingCount} >= 1`),
    // ONE blueprint per skill-group per user (dedupe on the md5 identity, since the
    // raw group_key is wire-unbounded and would blow the btree key limit).
    uniqueIndex('demo_blueprints_user_group_unique').on(table.userId, table.groupKeyHash),
  ],
);
