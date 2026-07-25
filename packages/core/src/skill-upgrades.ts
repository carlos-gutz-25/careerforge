import { z } from 'zod';

import {
  SKILL_LEVELS,
  evidenceKindSchema,
  skillLevelSchema,
  upgradeStatusSchema,
  type SkillLevel,
} from './enums.ts';

// M3-06 — Evidence → profile upgrades (ADR-0014). A completed exercise with
// full mastery evidence can EARN a profile skill a higher EFFECTIVE level,
// suggested deterministically and applied only on explicit confirmation, with a
// preserved audit trail. Everything here is PURE and CLOCK-FREE: deterministic
// CRUD + normalization, no LLM surface anywhere.
//
// Ownership split (ADR-0014, resolving the M0-08 parks):
// - DECLARED level = `profile_skills.level`, owned by the markdown importer,
//   untouched by this story.
// - EARNED level = an active row in `skill_upgrades` (a confirmed grant).
// - EFFECTIVE level = max(declared, active earned), computed at getProfile —
//   never stored. `max` (not "earned overrides") is load-bearing: a later
//   declared promotion must never be capped by an older lower grant.

/**
 * THE shared profile-skill name normalization (M0-08b park 3 resolution).
 * Exactly the DB unique-index expression `lower(name)` — deliberately NOT
 * `trim(name).toLowerCase()`: adding trim would mint a third, subtly different
 * normalization that collides where the `lower(name)` index does not. The
 * parser already trims table cells upstream, and every grant derives its key
 * from a stored (already-trimmed) `profile_skills` row, so trim is structurally
 * upstream of this key. Both the importer's dedup and the upgrade writer route
 * through this one function, so they provably share one normalization.
 */
export function skillNameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Skill-level rank, DERIVED from `SKILL_LEVELS` array order (its only rank
 * signal): the array is highest-to-lowest, so `expert` (index 0) ranks highest
 * and `learning` (last) lowest. Higher number = higher level.
 */
export const SKILL_LEVEL_RANK: Readonly<Record<SkillLevel, number>> = Object.fromEntries(
  SKILL_LEVELS.map((level, index) => [level, SKILL_LEVELS.length - 1 - index]),
) as Record<SkillLevel, number>;

/**
 * The effective-level combinator: the highest-ranked of the given levels. Used
 * at the getProfile choke point to fold a skill's declared level together with
 * its active earned grants (`maxSkillLevel(declared, ...earnedToLevels)`). At
 * least one level is required (the declared level is always present), so there
 * is no empty case.
 */
export function maxSkillLevel(first: SkillLevel, ...rest: SkillLevel[]): SkillLevel {
  let best = first;
  for (const level of rest) {
    if (SKILL_LEVEL_RANK[level] > SKILL_LEVEL_RANK[best]) best = level;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Wire contracts.

/** Length bound on the optional user-authored revoke `note` — untrusted text,
 *  escaped on display, NUL-rejected at the boundary (the artifactUrl idiom). */
export const SKILL_UPGRADE_REVOKE_NOTE_MAX_CHARS = 1000;

// A Postgres text column rejects U+0000 outright — reject at the boundary for a
// value-free 400 instead of a 500. The guard uses the escaped U+0000 code unit,
// never a raw NUL byte (source-byte law).
const noNul = (value: string) => !value.includes('\u0000');

/**
 * POST /skill-upgrades — confirm an earned upgrade. The client sends ONLY the
 * two ids; the server re-derives the whole grant (from/to level, matched
 * evidence) from the exercise + profile state (zero client trust). Free-text
 * skill entry is unrepresentable: a grant always names an existing profile
 * skill by id, so it can never create a skills.md-absent row.
 */
export const createSkillUpgradeBodySchema = z.strictObject({
  profileSkillId: z.uuid(),
  exerciseId: z.uuid(),
});
export type CreateSkillUpgradeBody = z.infer<typeof createSkillUpgradeBodySchema>;

/** POST /skill-upgrades/:id/revoke — flip an active grant to revoked. The
 *  optional `note` records why; effective level falls back to declared. */
export const revokeSkillUpgradeBodySchema = z.strictObject({
  note: z
    .string()
    .trim()
    .min(1)
    .max(SKILL_UPGRADE_REVOKE_NOTE_MAX_CHARS)
    .refine(noNul, 'must not contain U+0000')
    .nullish(),
});
export type RevokeSkillUpgradeBody = z.infer<typeof revokeSkillUpgradeBodySchema>;

/** One snapshotted evidence row justifying a grant. Snapshots are durable: they
 *  survive the source exercise/evidence being deleted (FK SET NULL). Requirement
 *  and gap text are DELIBERATELY not snapshotted (privacy-coherence, ADR-0014):
 *  posting-derived text must not outlive a posting hard-delete. */
export const skillUpgradeEvidenceSchema = z.strictObject({
  kind: evidenceKindSchema,
  artifactUrl: z.string().nullable(),
  recordedOn: z.iso.date(),
});
export type SkillUpgradeEvidence = z.infer<typeof skillUpgradeEvidenceSchema>;

/**
 * One skill-upgrade grant on the wire (POST 201, GET /skill-upgrades list,
 * revoke 200). `fromLevel` = the effective level at grant time (audit baseline);
 * `toLevel` = the earned level (always `solid` by service rule). `detached` is
 * DERIVED read-time: an active grant whose `skillNameKey` matches no current
 * profile skill (a markdown rename is delete+insert under full-sync, so the
 * grant survives but its skill name no longer exists — the honest signal to
 * revoke or re-earn, OD-8). `user_id` never crosses the wire.
 */
export const skillUpgradeSchema = z.strictObject({
  id: z.string(),
  skillName: z.string(),
  skillNameKey: z.string(),
  fromLevel: skillLevelSchema,
  toLevel: skillLevelSchema,
  status: upgradeStatusSchema,
  revokedAt: z.iso.datetime().nullable(),
  revokeNote: z.string().nullable(),
  exerciseId: z.string().nullable(),
  exerciseTitle: z.string(),
  detached: z.boolean(),
  evidence: z.array(skillUpgradeEvidenceSchema),
  createdAt: z.iso.datetime(),
});
export type SkillUpgrade = z.infer<typeof skillUpgradeSchema>;

/** One matched requirement backing a suggested upgrade — `text` is the
 *  requirement text (escaped on display, never persisted into the grant). */
export const skillUpgradeSuggestionRequirementSchema = z.strictObject({
  gapId: z.string(),
  requirementId: z.string(),
  text: z.string(),
});
export type SkillUpgradeSuggestionRequirement = z.infer<
  typeof skillUpgradeSuggestionRequirementSchema
>;

/** One completed exercise whose evidence backs a suggested upgrade. */
export const skillUpgradeSuggestionExerciseSchema = z.strictObject({
  exerciseId: z.string(),
  title: z.string(),
  completedOn: z.iso.date(),
  matchedRequirements: z.array(skillUpgradeSuggestionRequirementSchema),
});
export type SkillUpgradeSuggestionExercise = z.infer<typeof skillUpgradeSuggestionExerciseSchema>;

/**
 * A deterministically-derived upgrade suggestion for GET /skill-upgrade-
 * suggestions (recomputed per request — nothing stored, nothing stale).
 * `currentLevel` is the skill's effective level today; `suggestedLevel` is
 * always `solid` (OD-4: `expert` is markdown-only and buys no extra engine
 * effect; `rusty` is unreachable from exercise evidence). Suggestions exist only
 * for skills already in the profile — never a row creation.
 */
export const skillUpgradeSuggestionSchema = z.strictObject({
  profileSkillId: z.string(),
  skillName: z.string(),
  currentLevel: skillLevelSchema,
  suggestedLevel: skillLevelSchema,
  exercises: z.array(skillUpgradeSuggestionExerciseSchema),
});
export type SkillUpgradeSuggestion = z.infer<typeof skillUpgradeSuggestionSchema>;

/** GET /skill-upgrade-suggestions (200). */
export const skillUpgradeSuggestionsResponseSchema = z.strictObject({
  suggestions: z.array(skillUpgradeSuggestionSchema),
});
export type SkillUpgradeSuggestionsResponse = z.infer<typeof skillUpgradeSuggestionsResponseSchema>;

/** GET /skill-upgrades (200) — the audit view, active + revoked grants. */
export const skillUpgradesResponseSchema = z.strictObject({
  upgrades: z.array(skillUpgradeSchema),
});
export type SkillUpgradesResponse = z.infer<typeof skillUpgradesResponseSchema>;

/** POST /skill-upgrades (201) and POST /skill-upgrades/:id/revoke (200) both
 *  return the single affected grant. */
export const skillUpgradeResponseSchema = skillUpgradeSchema;
export type SkillUpgradeResponse = z.infer<typeof skillUpgradeResponseSchema>;
