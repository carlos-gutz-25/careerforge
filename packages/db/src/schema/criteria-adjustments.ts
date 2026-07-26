import {
  CRITERIA_ADJUSTMENT_KINDS,
  SIGNAL_CATEGORIES,
  type CriteriaAdjustmentEvidence,
  type SearchCriteriaData,
} from '@careerforge/core';
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { enumCheck, id, timestamps } from './helpers.ts';

// M4-02: criteria_adjustments (Outcomes → matching feedback; ERD amended,
// ARCHITECTURE §3). A row is a CONFIRMED, user-authored REMOVAL of a search
// criterion slug, applied only on explicit confirmation with its supporting
// evidence frozen — deterministic CRUD, NOT LLM-drafted (no run table, no
// citation tripwire; the M3-06/M4-01 class). Additive, forward-only (migration
// 0017): a new table with zero existing rows ⇒ no backfill ⇒ no hand-edit.
//
// APPEND-ONLY audit (the resume_variants precedent): a confirmed adjustment is
// never deleted or revoked. There is NO revoke verb — undoing an adjustment is
// an ordinary PUT /criteria that re-adds the slug, and the audit trail stays
// true either way (it records what was applied and when, not the current state).
// And NO unique index: convergence is natural (an applied removal leaves the
// slug out of criteria, so re-deriving the same suggestion needs the slug back),
// and revert→re-apply is legitimate history, so the full trail accumulates.
export const criteriaAdjustments = pgTable(
  'criteria_adjustments',
  {
    id: id(),
    // ADR-0007: every table carries user_id. CASCADE — a user delete removes
    // their audit trail along with everything else they own.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The two removal kinds (CHECK ∈ CRITERIA_ADJUSTMENT_KINDS).
    kind: text({ enum: CRITERIA_ADJUSTMENT_KINDS }).notNull(),
    // The `increase_score_for` category a positive-signal removal targeted;
    // NULL for a negative-signal removal (the flat decreaseScoreFor list has no
    // category). Two CHECKs below: the value set, and the kind↔nullness law.
    category: text({ enum: SIGNAL_CATEGORIES }),
    // The removed slug (a lowercase_snake criteria vocabulary value).
    slug: text().notNull(),
    // The 2×2 evidence EXACTLY as seen at confirm time — freezes what justified
    // the removal. Ids + user-curated company/title + stages + counts ONLY; NO
    // requirement text or posting quotes ever (privacy-coherence, the
    // skill_upgrades no-requirement-snapshot precedent — posting-derived text
    // must not outlive a posting hard-delete).
    evidence: jsonb().$type<CriteriaAdjustmentEvidence>().notNull(),
    // The full criteria document before and after the removal (the
    // fit_reports.criteria_snapshot self-explaining precedent) — the audit truth
    // of what the confirmation changed. DB-only: never re-served on the wire.
    criteriaBefore: jsonb().$type<SearchCriteriaData>().notNull(),
    criteriaAfter: jsonb().$type<SearchCriteriaData>().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('criteria_adjustments_kind_check', table.kind, CRITERIA_ADJUSTMENT_KINDS),
    // category ∈ the 5 signal categories when present; NULL passes (a CHECK is
    // satisfied when its expression is NULL, so a nullable enum needs no OR).
    enumCheck('criteria_adjustments_category_check', table.category, SIGNAL_CATEGORIES),
    // The kind↔category law, boolean-equality form: category is non-NULL IFF the
    // kind is remove_positive_signal (the interview_prep_points type↔FK-nullness
    // precedent). This is the SLICE-2 planted-FAIL target — dropping it lets a
    // categoryless positive (or a categoried negative) insert succeed.
    check(
      'criteria_adjustments_category_kind_check',
      sql`(${table.kind} = 'remove_positive_signal') = (${table.category} is not null)`,
    ),
  ],
);
