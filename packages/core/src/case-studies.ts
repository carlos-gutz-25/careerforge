import { z } from 'zod';

import {
  caseStudyStatusSchema,
  exerciseCaseStudyProvenanceSchema,
  projectProvenanceSchema,
} from './enums.ts';

// M4-01 — Exercise -> case-study draft. A completed exercise (M3-02) with full
// mastery evidence (M3-03) DETERMINISTICALLY generates a case-study draft
// pre-filled with the portfolio template sections, linked-artifact lines, and a
// provenance label; publishing stays a manual portfolio-content step (the
// module wall stands). No LLM surface anywhere — pure template assembly (the
// M3-06 class): schema + service, no prompt, no corpus, no run table. The
// wire contracts live here; the renderer lives in ./case-study-markdown.ts.

/** Mirrors EXERCISE_TITLE_MAX_CHARS — a case-study title defaults to the
 *  exercise title, so the two bounds match. */
export const CASE_STUDY_TITLE_MAX_CHARS = 200;

// A Postgres text column rejects U+0000 outright — reject at the boundary for a
// value-free 400 instead of a 500. The guard uses the escaped U+0000 code unit,
// never a raw NUL byte (source-byte law).
const noNul = (value: string) => !value.includes('\u0000');

/**
 * POST /case-studies — generate (or refresh) a draft from a completed exercise.
 * The client sends the exercise id + an explicit provenance choice; the server
 * re-derives every section from the exercise + evidence + gap-link state (zero
 * client trust — the exercise's completion status is re-checked server-side,
 * never taken from the client). `title` is optional and defaults to the
 * exercise title server-side; on a refresh POST an omitted title RESETS the
 * stored title to the exercise title (full-replacement semantics, OD-1).
 * Provenance is wire-restricted to the personal subset (OD-3).
 */
export const createCaseStudyBodySchema = z.strictObject({
  exerciseId: z.uuid(),
  provenance: exerciseCaseStudyProvenanceSchema,
  title: z
    .string()
    .trim()
    .min(1)
    .max(CASE_STUDY_TITLE_MAX_CHARS)
    .refine(noNul, 'must not contain U+0000')
    .optional(),
});
export type CreateCaseStudyBody = z.infer<typeof createCaseStudyBodySchema>;

/**
 * One case-study draft on the wire (POST 201/200, GET /case-studies/:id,
 * publish 200). `provenance` uses the FULL storage vocabulary — honest to the
 * column, which admits `professional` even though the wire only accepts the
 * personal subset. `exerciseId` is nullable: a source-exercise delete sets the
 * navigation FK NULL while the draft + `exerciseTitle` snapshot survive (the
 * M3-06 SET-NULL precedent). `updatedAt` is the last-refresh instant.
 * `user_id` never crosses the wire.
 */
export const caseStudySchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  provenance: projectProvenanceSchema,
  status: caseStudyStatusSchema,
  exerciseId: z.string().nullable(),
  exerciseTitle: z.string(),
  renderedMarkdown: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CaseStudy = z.infer<typeof caseStudySchema>;

/** GET /case-studies list items omit the (potentially large) rendered markdown
 *  body — the list is a picker, the detail GET carries the body. */
export const caseStudyListItemSchema = caseStudySchema.omit({ renderedMarkdown: true });
export type CaseStudyListItem = z.infer<typeof caseStudyListItemSchema>;

/** GET /case-studies (200). */
export const caseStudiesResponseSchema = z.strictObject({
  caseStudies: z.array(caseStudyListItemSchema),
});
export type CaseStudiesResponse = z.infer<typeof caseStudiesResponseSchema>;

/** POST /case-studies (201/200), GET /case-studies/:id (200), and
 *  POST /case-studies/:id/publish (200) all return the single affected draft. */
export const caseStudyResponseSchema = caseStudySchema;
export type CaseStudyResponse = z.infer<typeof caseStudyResponseSchema>;
