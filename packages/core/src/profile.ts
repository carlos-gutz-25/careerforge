import { z } from 'zod';

import {
  profileFactKindSchema,
  projectProvenanceSchema,
  skillLevelSchema,
  RELOCATION_STANCES,
  REMOTE_ONSITE_STANCES,
  VISA_SPONSORSHIP_NEEDED_VALUES,
  type ProfileFactKind,
} from './enums.ts';

// Wire contract for GET /profile (M0-10, approved shape 2026-07-15): the
// profile tables as flat arrays — DB truth, no view shaping. apps/api
// declares this as its response schema (the zod serializer strips anything
// undeclared) and apps/web consumes the inferred types, so both sides of the
// wire share one definition. Dates travel as ISO YYYY-MM-DD strings, matching
// the DB date columns.

export const profileSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  level: skillLevelSchema,
  years: z.number().int().nullable(),
  lastUsed: z.iso.date().nullable(),
});
export type ProfileSkill = z.infer<typeof profileSkillSchema>;

export const profileExperienceSchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  startDate: z.iso.date(),
  // NULL = current position (schema convention, packages/db).
  endDate: z.iso.date().nullable(),
});
export type ProfileExperience = z.infer<typeof profileExperienceSchema>;

export const profileProjectSchema = z.object({
  id: z.string(),
  // Nullable: personal projects carry no employer context.
  experienceId: z.string().nullable(),
  name: z.string(),
  provenance: projectProvenanceSchema,
  summary: z.string().nullable(),
});
export type ProfileProject = z.infer<typeof profileProjectSchema>;

export const profileResponseSchema = z.object({
  skills: z.array(profileSkillSchema),
  experiences: z.array(profileExperienceSchema),
  projects: z.array(profileProjectSchema),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

// M6-04 (ADR-0018) - the profile_contact.links READ boundary. `links` is
// jsonb written by the M6-01 parser (profile.ts db schema: {label, url}[]);
// M6-04's compose-inputs read is the FIRST consumer that reads it back across a
// boundary and therefore OWES this zod validation (the zod-at-every-boundary
// law; the M6-01 profile.ts:177-180 debt + ADVISORY-B). Postgres jsonb is
// unvalidated bytes at read time, so the repository safeParses `links` with this
// schema and treats a malformed value as a data-integrity error, never silent
// trust (the env / LLM-output safeParse precedent).
export const profileContactLinkSchema = z.strictObject({
  label: z.string(),
  url: z.string(),
});
export type ProfileContactLink = z.infer<typeof profileContactLinkSchema>;
export const profileContactLinksSchema = z.array(profileContactLinkSchema);

// M3-06 (ADR-0014) — the GET /profile skill shape. `level` is the EFFECTIVE
// level (the getProfile overlay computes max(declared, active earned grants));
// `declaredLevel` is the raw markdown-owned value, ALWAYS present, so elevation
// from an earned upgrade is visible at the wire (silent elevation on an
// export-feeding surface would be a debugging trap — OD-7).
//
// Deliberately a SEPARATE schema from `profileSkillSchema` (not an in-place
// field): the fit engine consumes `profileResponseSchema` (unchanged), whose
// z.object parse STRIPS the extra `declaredLevel` key the getProfile overlay
// emits — so the deterministic scoring engine reads effective-level only and is
// provably unaffected by this story (pinned by a scoring parse test).
export const profileSkillWithDeclaredSchema = profileSkillSchema.extend({
  declaredLevel: skillLevelSchema,
});
export type ProfileSkillWithDeclared = z.infer<typeof profileSkillWithDeclaredSchema>;

/** GET /profile (M0-10 shape, M3-06-elevated): skills carry effective +
 *  declared levels; experiences/projects unchanged. */
export const profileWithDeclaredResponseSchema = profileResponseSchema.extend({
  skills: z.array(profileSkillWithDeclaredSchema),
});
export type ProfileWithDeclaredResponse = z.infer<typeof profileWithDeclaredResponseSchema>;

// M12-03 (ADR-0021) — a durable profile fact on the wire (GET /profile/facts,
// and the import validation contract). Facts are informative, NEVER hard
// filters (arc D-4). `value` carries a closed vocabulary for the three
// decision-bearing kinds (validated per-kind by the superRefine below) and
// free-form text for the other three (validated non-empty); `note` is an
// optional human aside. Dates travel as ISO strings, matching the DB columns:
// `declaredAt` = the YYYY-MM-DD the fact was declared in facts.md, `updatedAt`
// = the row's last-write timestamp. A Postgres text column rejects U+0000
// outright, so reject at the boundary for a value-free 400 (the gaps.ts note
// precedent). Fact VALUES never enter logs/LLM payloads (the logging law).
const factNoNul = (value: string) => !value.includes(String.fromCharCode(0));

export const PROFILE_FACT_VALUE_MAX_CHARS = 200;
export const PROFILE_FACT_NOTE_MAX_CHARS = 300;

// The closed value vocabularies, keyed by kind. Kinds ABSENT from this map take
// free-form (non-empty) values (work_authorization / security_clearance /
// availability_notice). The DB mirrors these in a conditional CHECK (belt and
// suspenders — the enums.ts DB/app-agree invariant); this is the app boundary.
const CLOSED_FACT_VALUE_VOCABS: Partial<Record<ProfileFactKind, readonly string[]>> = {
  visa_sponsorship_needed: VISA_SPONSORSHIP_NEEDED_VALUES,
  relocation_stance: RELOCATION_STANCES,
  remote_onsite_stance: REMOTE_ONSITE_STANCES,
};

const refineFactValueByKind = (
  fact: { kind: ProfileFactKind; value: string },
  ctx: z.RefinementCtx,
): void => {
  const vocab = CLOSED_FACT_VALUE_VOCABS[fact.kind];
  if (vocab !== undefined && !vocab.includes(fact.value)) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: `${fact.kind} value must be one of: ${vocab.join(', ')}`,
    });
  }
};

export const profileFactSchema = z
  .strictObject({
    id: z.string(),
    kind: profileFactKindSchema,
    value: z
      .string()
      .min(1)
      .max(PROFILE_FACT_VALUE_MAX_CHARS)
      .refine(factNoNul, 'must not contain U+0000'),
    note: z
      .string()
      .max(PROFILE_FACT_NOTE_MAX_CHARS)
      .refine(factNoNul, 'must not contain U+0000')
      .nullable(),
    declaredAt: z.iso.date(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine(refineFactValueByKind);
export type ProfileFact = z.infer<typeof profileFactSchema>;

/** GET /profile/facts — the declared facts for the session user, in canonical
 *  (kind) order. Read-only in v2.1: facts.md is the source of truth (D-4). */
export const profileFactsResponseSchema = z.object({
  facts: z.array(profileFactSchema),
});
export type ProfileFactsResponse = z.infer<typeof profileFactsResponseSchema>;

/** The facts.md IMPORT shape (pre-DB: no id/updatedAt — those are DB-assigned).
 *  Same value-vocabulary, U+0000, length, and date rules as the wire schema; the
 *  importer validates each parsed facts.md entry against this before handing it
 *  to the repository (zod-at-every-boundary). */
export const profileFactImportSchema = z
  .strictObject({
    kind: profileFactKindSchema,
    value: z
      .string()
      .min(1)
      .max(PROFILE_FACT_VALUE_MAX_CHARS)
      .refine(factNoNul, 'must not contain U+0000'),
    note: z
      .string()
      .max(PROFILE_FACT_NOTE_MAX_CHARS)
      .refine(factNoNul, 'must not contain U+0000')
      .nullable(),
    declaredAt: z.iso.date(),
  })
  .superRefine(refineFactValueByKind);
export type ProfileFactImportFields = z.infer<typeof profileFactImportSchema>;
