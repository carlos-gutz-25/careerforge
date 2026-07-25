import { EVIDENCE_KINDS, SKILL_LEVELS, UPGRADE_STATUSES } from '@careerforge/core';
import { sql } from 'drizzle-orm';
import { date, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { exercises } from './exercises.ts';
import { enumCheck, id, timestamps } from './helpers.ts';
import { masteryEvidence } from './mastery.ts';
import { profileSkills } from './profile.ts';

// M3-06: skill_upgrades + skill_upgrade_evidence (Skill Accelerator; amended
// ERD, ARCHITECTURE §3). A skill_upgrade is a CONFIRMED, user-authored grant
// that earns a profile skill a higher EFFECTIVE level from completed-exercise
// mastery evidence — deterministic CRUD, NOT LLM-drafted (no run table, no
// citation tripwire). Additive, forward-only (migration 0015). New tables have
// zero existing rows ⇒ no backfill ⇒ no hand-edit.
//
// OWNERSHIP CONTRACT (ADR-0014 — resolving the four M0-08 importer parks):
//   - DECLARED level = `profile_skills.level`, owned by the markdown importer
//     (syncProfile), untouched by this story.
//   - EARNED level  = an ACTIVE row here (`to_level`, always 'solid').
//   - EFFECTIVE level = max(declared, active earned), COMPUTED at the single
//     getProfile read choke point — NEVER stored. A raw `profile_skills` reader
//     that bypasses getProfile sees declared-only; today the only such reader is
//     syncProfile, which is the point (the importer must not see earned levels,
//     so a re-import can never revert a grant — park 2 resolved structurally).
//   Any future reader wanting the effective level MUST route through getProfile.
//
// APPEND-ONLY (park 4): a grant is never deleted; revocation is a status flip
// (`status` active→revoked + `revoked_at`/`revoke_note`). After revoke the
// effective level falls back to declared. Downgrading the DECLARED level stays
// Carlos-owned via skills.md + re-import.
export const skillUpgrades = pgTable(
  'skill_upgrades',
  {
    id: id(),
    // ADR-0007: every table carries user_id (the mastery_evidence precedent).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Navigation FK to the granted skill. ON DELETE SET NULL (M2-10
    // resume_variant precedent): the durable audit is the snapshots below, so a
    // profile re-import that removes/renames the skill (full-sync delete) NULLs
    // this pointer WITHOUT destroying the grant or its trail. `skill_name_key`
    // (below), not this FK, is how the getProfile overlay re-associates a grant
    // with its skill — the FK is a convenience, the key is the identity.
    profileSkillId: uuid().references(() => profileSkills.id, { onDelete: 'set null' }),
    // Display snapshot of the skill name at grant time (survives the FK NULL).
    skillName: text().notNull(),
    // THE association key = skillNameKey(name) = lower(name), EXACTLY the
    // `profile_skills` unique-index expression (core skillNameKey; M0-08b park 3
    // — deliberately not trim+lower). The getProfile overlay merges active
    // grants onto skills by this key; the partial unique index below is scoped
    // on it. A markdown rename is delete+insert under full-sync, so neither this
    // key nor the FK survives a rename — the grant DETACHES (derived read-time,
    // OD-8), the honest signal to revoke or re-earn.
    skillNameKey: text().notNull(),
    // The effective level at grant time (audit baseline) and the earned level.
    // `to_level` is always 'solid' by service rule (OD-4); the CHECK admits the
    // whole enum — rank logic is service-side (the D1-gate pattern), not a DB
    // constraint.
    fromLevel: text({ enum: SKILL_LEVELS }).notNull(),
    toLevel: text({ enum: SKILL_LEVELS }).notNull(),
    // Lifecycle. Default 'active'; a revoke flips to 'revoked' and stamps the
    // two columns below. Never deleted.
    status: text({ enum: UPGRADE_STATUSES }).notNull().default('active'),
    revokedAt: timestamp({ withTimezone: true }),
    // User-authored, UNTRUSTED on display (escaped); bounded + NUL-rejected at
    // the wire boundary (core skill-upgrades.ts). NULL when no reason was given.
    revokeNote: text(),
    // The exercise whose evidence justified the grant. ON DELETE SET NULL — a
    // plan delete cascades exercises→evidence, but the grant's trail must
    // outlive it, so the snapshots (title here, evidence rows in the child
    // table) are durable and this FK is navigation-only.
    exerciseId: uuid().references(() => exercises.id, { onDelete: 'set null' }),
    exerciseTitle: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('skill_upgrades_from_level_check', table.fromLevel, SKILL_LEVELS),
    enumCheck('skill_upgrades_to_level_check', table.toLevel, SKILL_LEVELS),
    enumCheck('skill_upgrades_status_check', table.status, UPGRADE_STATUSES),
    // AT MOST ONE active grant per (user, skill key) — the DB backstop for the
    // one-active-grant invariant (23505 → 409 UPGRADE_ALREADY_ACTIVE, the M0-08
    // lower(name) backstop precedent). PARTIAL: revoked grants are unconstrained,
    // so re-earning after a revoke is allowed and the full history accumulates.
    uniqueIndex('skill_upgrades_user_key_active_unique')
      .on(table.userId, table.skillNameKey)
      .where(sql`status = 'active'`),
  ],
);

// The "which evidence justified which upgrade" trail. Snapshot scope at grant
// time = ALL evidence rows of the exercise (not just the predicate trio — the
// full trail, incl. extra `implemented` artifacts and any `revisited`).
//
// DELIBERATELY ABSENT (privacy-coherence, ADR-0014): no requirement/gap text
// snapshots anywhere — posting-derived text must not outlive a posting
// hard-delete (`requirements` cascade with postings by design). A grant
// references the justifying exercise + evidence; the why-it-matched requirement
// context is recomputable while the posting lives and gone after purge (a named
// residual, not a leak).
export const skillUpgradeEvidence = pgTable(
  'skill_upgrade_evidence',
  {
    id: id(),
    // ADR-0007: user_id on every table.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The grant this snapshot belongs to; CASCADE — the trail is intrinsic to the
    // grant (grants are never deleted, but a user delete must not strand rows).
    skillUpgradeId: uuid()
      .notNull()
      .references(() => skillUpgrades.id, { onDelete: 'cascade' }),
    // Navigation to the source evidence row. ON DELETE SET NULL — evidence is
    // freely deletable (D2 guards only the last implemented/tested), and a plan
    // delete cascades to it; the snapshot columns below are the durable record.
    masteryEvidenceId: uuid().references(() => masteryEvidence.id, { onDelete: 'set null' }),
    // Snapshots of the evidence at grant time (survive the FK NULL).
    kind: text({ enum: EVIDENCE_KINDS }).notNull(),
    artifactUrl: text(),
    recordedOn: date().notNull(),
    ...timestamps(),
  },
  (table) => [enumCheck('skill_upgrade_evidence_kind_check', table.kind, EVIDENCE_KINDS)],
);
