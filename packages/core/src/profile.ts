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
