import {
  RESUME_EMPHASIS_LEVELS,
  RESUME_ENTITY_TYPES,
  RESUME_VARIANT_REVIEW_STATUSES,
  RESUME_VARIANT_RUN_STATUSES,
} from '@careerforge/core';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { fitReports } from './fit.ts';
import { gaps } from './gaps.ts';
import { enumCheck, id, timestamps } from './helpers.ts';
import { profileExperiences, profileProjects, profileSkills } from './profile.ts';

// M2-10: per-posting resume tailoring artifacts (amended ERD, ARCHITECTURE §3).
// A variant is an LLM-DRAFTED, append-only artifact of exactly ONE fit report
// (pin-to-report; UNIQUE fit_report_id enforces the drawn ||--o|) and is
// draft-until-reviewed (ADR-0012). The audit table mirrors improvement_plan_runs
// column-for-column — one row per WIRE CALL (the M1-05 law at its third call
// site); the variant row is created only from an ok, spec-valid run (the
// improvement_plans ↔ plan_items parallel). The model emits only ordering +
// emphasis over server-assigned refs, never resume prose: the rendered markdown
// is built 100% from DB-row strings by a deterministic renderer (ADR-0012), so
// fabrication is impossible by construction.

export const resumeVariantRuns = pgTable(
  'resume_variant_runs',
  {
    id: id(),
    // ADR-0007: every table carries user_id (6th application).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // CASCADE: raw_response embeds profile- and posting-derived text; every real
    // deletion origin (posting or extraction_run) reaches fit_reports and must
    // not strand audit rows quoting it (the improvement_plan_runs precedent).
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
    // applied post-hoc by SPEC validation (a ref that was never sent, or an
    // order that is not an exact permutation — the M1-12 layer-4 analog) and
    // never by the runner.
    status: text({ enum: RESUME_VARIANT_RUN_STATUSES }).notNull(),
    // created_at written explicitly from LlmCallRecord.timestamp (runner clock,
    // F3); defaultNow is only the bypass fallback.
    ...timestamps(),
  },
  (table) => [
    enumCheck('resume_variant_runs_status_check', table.status, RESUME_VARIANT_RUN_STATUSES),
  ],
);

export const resumeVariants = pgTable(
  'resume_variants',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The pin-to-report anchor; UNIQUE below = the drawn ||--o| ("at most one
    // variant per report", the improvement_plans precedent). UNIQUE-as-cache,
    // no force lever — regeneration = re-score.
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    // Audit anchor: the ok, spec-valid wire call this variant was parsed from.
    tailoringRunId: uuid()
      .notNull()
      .references(() => resumeVariantRuns.id, { onDelete: 'cascade' }),
    // The snapshot export artifact, rendered ONCE at persist by the
    // deterministic renderer: what review approves is byte-for-byte what export
    // serves. Durable against a later profile re-import (see the entry-level
    // label/detail snapshots below).
    renderedMarkdown: text().notNull(),
    // Draft-until-reviewed workflow field (the improvement_plans precedent);
    // content stays append-only. Only a reviewed variant exports (409 on draft).
    reviewStatus: text({ enum: RESUME_VARIANT_REVIEW_STATUSES }).notNull().default('draft'),
    // Review-note parity with improvement_plans.notes; trimmed-or-null at the
    // service boundary, captured by the one-shot review CAS.
    notes: text(),
    ...timestamps(),
  },
  (table) => [
    enumCheck(
      'resume_variants_review_status_check',
      table.reviewStatus,
      RESUME_VARIANT_REVIEW_STATUSES,
    ),
    uniqueIndex('resume_variants_fit_report_id_unique').on(table.fitReportId),
  ],
);

export const resumeVariantEntries = pgTable(
  'resume_variant_entries',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Entries are derived artifacts of their variant — they go with it.
    resumeVariantId: uuid()
      .notNull()
      .references(() => resumeVariants.id, { onDelete: 'cascade' }),
    section: text({ enum: RESUME_ENTITY_TYPES }).notNull(),
    // Server-assigned: skills/projects from spec order, experiences from DB
    // chronological order (the model has no experience-order field — the
    // ADR-0012 honesty invariant, structurally unrepresentable to violate).
    // Rows have no inherent order; reads sort by (section, position, id).
    position: integer().notNull(),
    // Profile pointers are navigation, not durability. SET NULL: profile rows
    // may be re-imported or deleted (M0-08 full-sync) — the label/detail
    // SNAPSHOTS below are the durable display, so a re-import cannot mutate a
    // reviewed artifact (the evidence_links precedent).
    profileSkillId: uuid().references(() => profileSkills.id, { onDelete: 'set null' }),
    profileProjectId: uuid().references(() => profileProjects.id, { onDelete: 'set null' }),
    profileExperienceId: uuid().references(() => profileExperiences.id, { onDelete: 'set null' }),
    // Durable display snapshots frozen at draft time (the mutable-profile hole
    // resolution): the user's own verified content, same trust class as their
    // resume.md.
    label: text().notNull(),
    detail: text(),
    // NULL (no emphasis row) = standard weight. `lead` surfaces in highlights,
    // `highlight` marks in place — emphasis only adds a citation marker, never
    // rewrites/drops/reorders content.
    emphasis: text({ enum: RESUME_EMPHASIS_LEVELS }),
    // The model's capped rationale — metadata, never resume content; UNTRUSTED
    // on display (RISKS S-02). Present iff emphasis is (the CHECK below).
    reason: text(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('resume_variant_entries_section_check', table.section, RESUME_ENTITY_TYPES),
    // NULL passes an IN-list CHECK by SQL semantics — nullable by design.
    enumCheck('resume_variant_entries_emphasis_check', table.emphasis, RESUME_EMPHASIS_LEVELS),
    // emphasis and reason are present together or absent together: a rationale
    // without an emphasis (or vice versa) is a malformed spec.
    check(
      'resume_variant_entries_emphasis_reason_check',
      sql`(${table.emphasis} is null) = (${table.reason} is null)`,
    ),
    // Per-section FK-nullness: only the matching profile FK may be non-null
    // (the matching one MAY still be null after a SET-NULL re-import — the
    // snapshot carries the display). Implication form so each section pins the
    // two non-matching FKs to NULL.
    check(
      'resume_variant_entries_section_fk_check',
      sql`(${table.section} <> 'skill' or (${table.profileProjectId} is null and ${table.profileExperienceId} is null))
        and (${table.section} <> 'experience' or (${table.profileSkillId} is null and ${table.profileProjectId} is null))
        and (${table.section} <> 'project' or (${table.profileSkillId} is null and ${table.profileExperienceId} is null))`,
    ),
    // Server-assigned position is unique within a (variant, section) — the
    // fit_sub_scores exactly-once law applied to render slots.
    uniqueIndex('resume_variant_entries_variant_section_position_unique').on(
      table.resumeVariantId,
      table.section,
      table.position,
    ),
  ],
);

export const resumeVariantCitations = pgTable(
  'resume_variant_citations',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Citations are derived artifacts of their entry — they go with it.
    resumeVariantEntryId: uuid()
      .notNull()
      .references(() => resumeVariantEntries.id, { onDelete: 'cascade' }),
    // The citation (structural, FK — never prose-parsed). CASCADE is total: gap
    // rows only vanish via a cascade that removes this variant through its own
    // fit_report_id FK in the SAME statement — gaps and the variant share the
    // fit_report ancestor, and requirements/gaps are append-only (never deleted
    // individually), so a posting/user deletion removes both routes at once (no
    // orphan; the plan_items.gap_id both-route trace).
    gapId: uuid()
      .notNull()
      .references(() => gaps.id, { onDelete: 'cascade' }),
    // Model citation order within its entry; reads sort by (position, id).
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    // At most one citation per (entry, gap) — a gap is cited once per emphasis.
    uniqueIndex('resume_variant_citations_entry_gap_unique').on(
      table.resumeVariantEntryId,
      table.gapId,
    ),
  ],
);
