import { z } from 'zod';

import {
  gapClassificationSchema,
  planDraftingRunStatusSchema,
  planItemPrioritySchema,
  planItemStatusSchema,
  planReviewStatusSchema,
  requirementCategorySchema,
  requirementKindSchema,
} from './enums.ts';

// Wire contracts for POST/GET /fit-reports/:id/improvement-plan,
// POST /improvement-plans/:id/review and PATCH /plan-items/:id (M1-12).
// A plan is an LLM-DRAFTED, append-only artifact of exactly ONE fit report
// (pin-to-report; UNIQUE fit_report_id is the drawn ||--o| cardinality) and
// is draft-until-reviewed (ADR-0005 §3). Two values NEVER cross the wire:
// `raw_response` (audit/replay only; embeds profile- and gap-derived text)
// and `user_id`. Per-run usage IS on the wire deliberately (RISKS T-03, the
// extraction run precedent). `action` is LLM-generated and the gap display
// fields are posting-derived — all UNTRUSTED on display (RISKS S-02).

/** One drafting wire call on the wire — the ExtractionRun twin, one row per
 *  wire call (M1-05 law applied to the second call site). */
export const planDraftingRunSchema = z.strictObject({
  id: z.string(),
  promptId: z.string(),
  provider: z.string(),
  model: z.string(),
  status: planDraftingRunStatusSchema,
  attempt: z.number().int().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadInputTokens: z.number().int().min(0),
  cacheCreationInputTokens: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type PlanDraftingRun = z.infer<typeof planDraftingRunSchema>;

/**
 * One plan item with its cited gap's display fields joined per row (one
 * fetch renders the section — the gapResponseSchema precedent).
 * `gapClassification` is the gap's LIVE effective value at read time; the
 * item was drafted from the draft-time value, and the two can legitimately
 * diverge after a later gap override (named M1-12 residual — visible, not
 * explained, until re-score). `gapRequirementId` lets the UI look up
 * evidence links from the already-fetched fit report payload.
 */
export const planItemResponseSchema = z.strictObject({
  id: z.string(),
  gapId: z.string(),
  action: z.string(),
  priority: planItemPrioritySchema,
  status: planItemStatusSchema,
  position: z.number().int().min(0),
  gapClassification: gapClassificationSchema,
  gapRequirementId: z.string(),
  requirementText: z.string(),
  requirementKind: requirementKindSchema,
  requirementCategory: requirementCategorySchema,
});
export type PlanItemResponse = z.infer<typeof planItemResponseSchema>;

/** One improvement plan on the wire, items in model output order
 *  (position, id). `notes` is null until review captures them. */
export const improvementPlanResponseSchema = z.strictObject({
  id: z.string(),
  fitReportId: z.string(),
  reviewStatus: planReviewStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  items: z.array(planItemResponseSchema),
});
export type ImprovementPlanResponse = z.infer<typeof improvementPlanResponseSchema>;

/**
 * GET /fit-reports/:id/improvement-plan (and the POST result shape).
 * `plan: null` = not yet drafted — an empty collection, not a 404 (the
 * report exists; the GET requirements precedent). Run-selection contract
 * (M1-12 R2): when `plan` is non-null, `run` IS the plan's drafting run
 * (via drafting_run_id) — never latest-by-time, which a lost double-POST
 * race could point at the wrong wire call; latest-by-time applies ONLY when
 * `plan` is null (failure display). 201 = a fresh draft ran and its run
 * row(s) were appended — including non-ok terminal outcomes, which are
 * results, not transport errors (`run.status` is the discriminant and
 * `plan` is null). 200 with `cached: true` = the report's existing plan
 * served with no LLM call (UNIQUE fit_report_id is the cache analog of
 * ADR-0005 §4; regeneration = re-score).
 */
export const fitReportPlanResponseSchema = z.strictObject({
  run: planDraftingRunSchema.nullable(),
  plan: improvementPlanResponseSchema.nullable(),
  cached: z.boolean(),
});
export type FitReportPlanResponse = z.infer<typeof fitReportPlanResponseSchema>;

/** Cost-free sanity bound on plan review notes (text column, escaped on
 *  render; ~10× a long real note — the fit review precedent). */
export const PLAN_REVIEW_NOTES_MAX_CHARS = 10_000;

// A Postgres text column rejects U+0000 outright — reject at the boundary
// for a value-free 400 instead of a 500 (the fit review notes precedent).
const notesNoNul = (value: string) => !value.includes('\u0000');

/**
 * POST /improvement-plans/:id/review — the one-shot draft→reviewed action
 * (CAS on review_status='draft'; the M1-10 A2 precedent, second
 * application). `notes` is nullish (a body-less POST reaches the validator
 * as null); values that trim to empty are stored as NULL at the service
 * boundary.
 */
export const planReviewBodySchema = z.strictObject({
  notes: z
    .string()
    .max(PLAN_REVIEW_NOTES_MAX_CHARS)
    .refine(notesNoNul, 'must not contain U+0000')
    .nullish(),
});
export type PlanReviewBody = z.infer<typeof planReviewBodySchema>;

/** Review response is meta-only (no joins): the caller already renders the
 *  plan; this confirms the workflow-field transition. */
export const planReviewResponseSchema = z.strictObject({
  id: z.string(),
  reviewStatus: planReviewStatusSchema,
  notes: z.string().nullable(),
});
export type PlanReviewResponse = z.infer<typeof planReviewResponseSchema>;

/**
 * PATCH /plan-items/:id — FULL REPLACEMENT of the two mutable fields, both
 * required (the gap override A2 semantics, re-editable by design — no CAS,
 * no merge-patch). `action`, `gap_id`, and `position` are immutable: the
 * reviewed artifact is the LLM's cited draft, not an edited one; `dropped`
 * is the honest rejection path.
 */
export const planItemPatchBodySchema = z.strictObject({
  status: planItemStatusSchema,
  priority: planItemPrioritySchema,
});
export type PlanItemPatchBody = z.infer<typeof planItemPatchBodySchema>;

/** PATCH response is the full updated item — the ONE row contract shared
 *  with the GET, so the UI re-renders in place. */
export const planItemPatchResponseSchema = planItemResponseSchema;
export type PlanItemPatchResponse = z.infer<typeof planItemPatchResponseSchema>;
