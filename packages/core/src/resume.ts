import { z } from 'zod';

import {
  gapClassificationSchema,
  requirementCategorySchema,
  requirementKindSchema,
  resumeEmphasisLevelSchema,
  resumeEntityTypeSchema,
  resumeVariantReviewStatusSchema,
  resumeVariantRunStatusSchema,
} from './enums.ts';

// Wire contracts for POST/GET /fit-reports/:id/resume-variant,
// POST /resume-variants/:id/review and GET /resume-variants/:id/export
// (M2-10). A variant is an LLM-DRAFTED, append-only artifact of exactly ONE
// fit report (pin-to-report; UNIQUE fit_report_id is the drawn ||--o|
// cardinality) and is draft-until-reviewed (ADR-0012). It is a
// tailoring/emphasis guide over verified profile facts, not a bulleted resume.
// Two values NEVER cross the wire: `raw_response` (audit/replay only; embeds
// profile- and posting-derived text) and `user_id`. Per-run usage IS on the
// wire deliberately (RISKS T-03, the extraction run precedent). `reason` is
// LLM-generated and the citation display fields are posting-derived — all
// UNTRUSTED on display (RISKS S-02). `renderedMarkdown` is the stored snapshot
// artifact; the review approves it and the export serves it byte-for-byte.

/** One tailoring wire call on the wire — the ExtractionRun/PlanDraftingRun
 *  twin, one row per wire call (M1-05 law applied to the third call site). */
export const resumeVariantRunSchema = z.strictObject({
  id: z.string(),
  promptId: z.string(),
  provider: z.string(),
  model: z.string(),
  status: resumeVariantRunStatusSchema,
  attempt: z.number().int().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadInputTokens: z.number().int().min(0),
  cacheCreationInputTokens: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type ResumeVariantRun = z.infer<typeof resumeVariantRunSchema>;

/**
 * One cited gap's display fields, joined per citation row (one fetch renders
 * the section — the planItemResponse/gapResponse precedent). `gapClassification`
 * is the gap's LIVE effective value at read time; the entry was drafted from
 * the draft-time value, and the two can legitimately diverge after a later gap
 * override (the same named M1-12 residual — visible, not explained, until
 * re-score). `requirementId` lets the UI look up evidence links from the
 * already-fetched fit report payload.
 */
export const resumeVariantCitationSchema = z.strictObject({
  gapId: z.string(),
  gapClassification: gapClassificationSchema,
  requirementId: z.string(),
  requirementText: z.string(),
  requirementKind: requirementKindSchema,
  requirementCategory: requirementCategorySchema,
});
export type ResumeVariantCitation = z.infer<typeof resumeVariantCitationSchema>;

/**
 * One rendered variant entry with its citations joined per row. `label` and
 * `detail` are durable display SNAPSHOTS (frozen at draft time so a later
 * profile re-import cannot mutate a reviewed artifact); `emphasis`/`reason` are
 * null together (standard weight, no rationale). `position` is server-assigned
 * (skills/projects from spec order, experiences from DB chronological order —
 * the model has no experience-order field). Ordered `(section, position, id)`.
 */
export const resumeVariantEntrySchema = z.strictObject({
  id: z.string(),
  section: resumeEntityTypeSchema,
  position: z.number().int().min(0),
  label: z.string(),
  detail: z.string().nullable(),
  emphasis: resumeEmphasisLevelSchema.nullable(),
  reason: z.string().nullable(),
  citations: z.array(resumeVariantCitationSchema),
});
export type ResumeVariantEntry = z.infer<typeof resumeVariantEntrySchema>;

/** One resume variant on the wire, entries in render order. `notes` is null
 *  until review captures them. `renderedMarkdown` is the stored snapshot bytes
 *  (the `<pre>{{ }}</pre>` preview reads it; the export serves the same). */
export const resumeVariantResponseSchema = z.strictObject({
  id: z.string(),
  fitReportId: z.string(),
  reviewStatus: resumeVariantReviewStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  renderedMarkdown: z.string(),
  entries: z.array(resumeVariantEntrySchema),
});
export type ResumeVariantResponse = z.infer<typeof resumeVariantResponseSchema>;

/**
 * GET /fit-reports/:id/resume-variant (and the POST result shape).
 * `variant: null` = not yet drafted — an empty collection, not a 404 (the
 * report exists; the GET requirements precedent). Run-selection contract (the
 * M1-12 R2 lineage): when `variant` is non-null, `run` IS the variant's
 * tailoring run (via tailoring_run_id) — never latest-by-time, which a lost
 * double-POST race could point at the wrong wire call; latest-by-time applies
 * ONLY when `variant` is null (failure display). 201 = a fresh draft ran and
 * its run row(s) were appended — including non-ok terminal outcomes and the
 * `flagged` spec-validation outcome, which are results, not transport errors
 * (`run.status` is the discriminant and `variant` is null). 200 with
 * `cached: true` = the report's existing variant served with no LLM call
 * (UNIQUE fit_report_id is the cache; regeneration = re-score).
 */
export const fitReportResumeVariantResponseSchema = z.strictObject({
  run: resumeVariantRunSchema.nullable(),
  variant: resumeVariantResponseSchema.nullable(),
  cached: z.boolean(),
});
export type FitReportResumeVariantResponse = z.infer<typeof fitReportResumeVariantResponseSchema>;

/** Cost-free sanity bound on variant review notes (text column, escaped on
 *  render; ~10× a long real note — the plan/fit review precedent). */
export const RESUME_VARIANT_REVIEW_NOTES_MAX_CHARS = 10_000;

// A Postgres text column rejects U+0000 outright — reject at the boundary for a
// value-free 400 instead of a 500 (the plan/fit review notes precedent).
const notesNoNul = (value: string) => !value.includes('\u0000');

/**
 * POST /resume-variants/:id/review — the one-shot draft->reviewed action (CAS
 * on review_status='draft'; the M1-10 A2 / M1-12 precedent). `notes` is nullish
 * (a body-less POST reaches the validator as null); values that trim to empty
 * are stored as NULL at the service boundary.
 */
export const resumeVariantReviewBodySchema = z.strictObject({
  notes: z
    .string()
    .max(RESUME_VARIANT_REVIEW_NOTES_MAX_CHARS)
    .refine(notesNoNul, 'must not contain U+0000')
    .nullish(),
});
export type ResumeVariantReviewBody = z.infer<typeof resumeVariantReviewBodySchema>;

/** Review response is meta-only (no joins): the caller already renders the
 *  variant; this confirms the workflow-field transition. */
export const resumeVariantReviewResponseSchema = z.strictObject({
  id: z.string(),
  reviewStatus: resumeVariantReviewStatusSchema,
  notes: z.string().nullable(),
});
export type ResumeVariantReviewResponse = z.infer<typeof resumeVariantReviewResponseSchema>;
