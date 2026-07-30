import {
  PROFILE_FACT_KINDS,
  RELOCATION_STANCES,
  REMOTE_ONSITE_STANCES,
  VISA_SPONSORSHIP_NEEDED_VALUES,
} from '@careerforge/core';
import { sql } from 'drizzle-orm';
import { check, date, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M12-03 (ADR-0021): profile_facts — durable declarations ABOUT the candidate
// (work authorization, sponsorship need, location/remote stance, clearance,
// availability). Informative evaluators, NEVER hard filters (arc D-4). Additive,
// forward-only (migration 0024): a new table with zero existing rows ⇒ no
// backfill ⇒ no hand-edit (the case_studies 0016 / criteria_adjustments 0017
// precedent). ONE current row per (user, kind) — history lives in the git of the
// private facts.md, not in-table; the importer full-syncs by kind (absent =
// deleted, present = upsert), so the file is the source of truth (D-4). Fact
// VALUES are a sensitive class: never logged, never in LLM payloads.

// Inline a core value-set as a raw SQL literal list for a CHECK (the enumCheck
// helper's approach — CHECK constraints cannot carry bind params; values are our
// own trusted const tuples).
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const profileFacts = pgTable(
  'profile_facts',
  {
    id: id(),
    // ADR-0007: every table carries user_id. CASCADE — a user delete removes
    // their declarations (local, no audit obligation).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text({ enum: PROFILE_FACT_KINDS }).notNull(),
    value: text().notNull(),
    note: text(),
    // The YYYY-MM-DD the fact was declared in facts.md (freshness display).
    declaredAt: date().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('profile_facts_kind_check', table.kind, PROFILE_FACT_KINDS),
    // Belt-and-suspenders VALUE CHECK for the closed-vocabulary kinds: the app
    // boundary is core Zod (profileFactSchema.superRefine), this is the DB
    // backstop so a raw-SQL / future-migration write can never store an invalid
    // stance (the enums.ts DB/app-agree invariant). Implication form (the
    // criteria_adjustments 0017 / profile_education 0006 cross-column precedent):
    // free-form kinds (work_authorization / security_clearance /
    // availability_notice) match no clause and pass vacuously.
    check(
      'profile_facts_value_vocab_check',
      sql`(${table.kind} <> 'visa_sponsorship_needed' or ${table.value} in (${sqlList(VISA_SPONSORSHIP_NEEDED_VALUES)}))
        and (${table.kind} <> 'relocation_stance' or ${table.value} in (${sqlList(RELOCATION_STANCES)}))
        and (${table.kind} <> 'remote_onsite_stance' or ${table.value} in (${sqlList(REMOTE_ONSITE_STANCES)}))`,
    ),
    // One current value per (user, kind): the importer's idempotent upsert target
    // and the "one declaration per topic" law.
    uniqueIndex('profile_facts_user_kind_unique').on(table.userId, table.kind),
  ],
);
