import { z } from 'zod';

import { projectProvenanceSchema, skillLevelSchema } from './enums.ts';

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
