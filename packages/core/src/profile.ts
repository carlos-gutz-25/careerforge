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
