import { EVIDENCE_KINDS } from '@careerforge/core';
import { date, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { exercises } from './exercises.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M3-03: mastery_evidence (Skill Accelerator; amended ERD, ARCHITECTURE §3). A
// USER-AUTHORED record that an exercise (M3-02) was actually done — the four
// kinds implemented|tested|explained|revisited, an optional artifact link, and
// the date the work happened. Deterministic CRUD, NOT LLM-drafted (no run
// table). Additive, forward-only (migration 0012).
//
// TWO cross-table invariants are SERVICE preconditions, NOT schema constraints
// (Postgres cannot express "row in table A may reach status X only if ≥1 row of
// kind K exists in table B" — the M3-02 gap-membership precedent):
//   1. COMPLETION GATE — an exercise may become `complete` only with ≥1
//      `implemented` AND ≥1 `tested` evidence row (checked for EXISTENCE, not
//      count). Enforced in exercises.service.updateStatus (409).
//   2. AIRTIGHT DELETE-GUARD — deleting the LAST `implemented` or LAST `tested`
//      row of an already-`complete` exercise is refused (409), so the gate is a
//      true always-invariant, not just a transition check. Enforced in
//      mastery-evidence.service.remove.
export const masteryEvidence = pgTable(
  'mastery_evidence',
  {
    id: id(),
    // ADR-0007: every table carries user_id (the exercises precedent).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Evidence is a child of exactly one exercise; CASCADE — deleting the
    // exercise (the mis-create recourse) removes its evidence (no orphan).
    exerciseId: uuid()
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    // How the exercise was proven. Immutable after create (no PATCH; a
    // mis-created record is DELETEd). Text + CHECK (ADR-0003, never a pg enum).
    kind: text({ enum: EVIDENCE_KINDS }).notNull(),
    // Optional link (repo / test-run / writeup). NULL when the record carries
    // no URL (an `explained` whiteboard/verbal record). User-authored,
    // UNTRUSTED on display (escaped); bounded + NUL-rejected at the wire
    // boundary (core mastery-evidence.ts).
    artifactUrl: text(),
    // The date the work happened (ISO YYYY-MM-DD, string mode). The service
    // supplies it on every insert — the client's value or the server's today
    // (default) — and rejects a future date; distinct from created_at (the
    // insert instant). Not-null: the service never omits it.
    recordedOn: date().notNull(),
    ...timestamps(),
  },
  // No UNIQUE constraint by decision: a kind may legitimately RECUR — `revisited`
  // is recorded repeatedly (M3-05 spaced review), and multiple `implemented`
  // artifacts are valid. The gate checks existence (≥1), never count.
  (table) => [enumCheck('mastery_evidence_kind_check', table.kind, EVIDENCE_KINDS)],
);
