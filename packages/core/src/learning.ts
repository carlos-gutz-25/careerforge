import { z } from 'zod';

import {
  gapClassificationSchema,
  planDraftingRunStatusSchema,
  planItemPrioritySchema,
  planReviewStatusSchema,
  requirementCategorySchema,
  requirementKindSchema,
} from './enums.ts';

// Wire contracts for POST /learning-plans, GET /learning-plans/:id,
// GET /learning-plans and POST /learning-plans/:id/review (M3-01). A learning
// plan is an LLM-DRAFTED, append-only artifact drafted over a USER-SELECTED
// set of gaps that may span MULTIPLE postings (BACKLOG M3-01) — unlike an
// improvement plan (M1-12), which is pinned one-per-fit-report. There is no
// single report to pin to, so plans are FREE-CREATE (plural by design): the
// same gap set may seed two different plans. Draft-until-reviewed (ADR-0005
// §3). Two values NEVER cross the wire: `raw_response` (audit/replay only;
// embeds profile- and gap-derived text) and `user_id`. The drafted `focus`
// text and the gap display fields are LLM/posting-DERIVED — all UNTRUSTED on
// display (escaped; never rendered as HTML/markdown — RISKS S-02).

/** Cost + sanity bound on a single selection (well above any real gap set;
 *  the eligible-gap 409 still fires BEFORE any paid call). */
export const CREATE_LEARNING_PLAN_MAX_GAPS = 100;

/**
 * POST /learning-plans — draft from a selected gap set. `gapIds` is a
 * non-empty set of gap ids the caller owns; duplicates are collapsed at the
 * service boundary. No `title` here: the model drafts it (user-editable
 * later). The plan drafts ONLY over gaps whose source fit report is reviewed
 * and that are eligible (non-`have`); those preconditions are enforced in the
 * service (404 / 409) before any paid call.
 */
export const createLearningPlanBodySchema = z.strictObject({
  gapIds: z.array(z.uuid()).min(1).max(CREATE_LEARNING_PLAN_MAX_GAPS),
});
export type CreateLearningPlanBody = z.infer<typeof createLearningPlanBodySchema>;

/** One drafting wire call on the wire — the PlanDraftingRun twin (M1-05 law
 *  at its third call site), one row per wire call. No `fit_report_id`: a
 *  learning plan has no single source report (M3-01 delta). */
export const learningPlanRunSchema = z.strictObject({
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
export type LearningPlanRun = z.infer<typeof learningPlanRunSchema>;

/**
 * One cited gap of a learning plan, with its gap's display fields joined per
 * row (one fetch renders the section — the planItemResponseSchema precedent).
 * `focus` is the model's drafted per-gap learning focus (UNTRUSTED on
 * display). `priority` is model-assigned; `position` is the drafted order,
 * recurring gaps first (higher `seenInNPostings` — a syntactic recurrence,
 * M3-01 delta #4). `gapClassification` is the gap's LIVE effective value at
 * read time; the focus was drafted from the draft-time value and the two can
 * legitimately diverge after a later gap override (the M1-12 residual).
 */
export const learningPlanGapSchema = z.strictObject({
  id: z.string(),
  gapId: z.string(),
  focus: z.string(),
  priority: planItemPrioritySchema,
  position: z.number().int().min(0),
  gapClassification: gapClassificationSchema,
  gapRequirementId: z.string(),
  requirementText: z.string(),
  requirementKind: requirementKindSchema,
  requirementCategory: requirementCategorySchema,
});
export type LearningPlanGap = z.infer<typeof learningPlanGapSchema>;

/** One learning plan on the wire, cited gaps in drafted order (position, id).
 *  `notes` is null until review captures them. */
export const learningPlanSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  reviewStatus: planReviewStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  gaps: z.array(learningPlanGapSchema),
});
export type LearningPlan = z.infer<typeof learningPlanSchema>;

/**
 * POST /learning-plans result and GET /learning-plans/:id.
 * FREE-CREATE, so there is no cache: every successful POST appends a run and
 * (on an ok, citation-clean run) a fresh plan — 201. `plan: null` with a
 * non-ok/`flagged` `run` is a RESULT, not a transport error (`run.status` is
 * the discriminant). GET returns the plan's OWN drafting run (never
 * latest-by-time — there is no report to hang a latest-by-time failure
 * display on; a failed POST surfaced its run inline). `cached` is retained
 * for wire-shape parity with the plan family and is always false here.
 */
export const learningPlanResponseSchema = z.strictObject({
  run: learningPlanRunSchema.nullable(),
  plan: learningPlanSchema.nullable(),
  cached: z.boolean(),
});
export type LearningPlanResponse = z.infer<typeof learningPlanResponseSchema>;

/** GET /learning-plans — the list (plural by design), newest first, meta
 *  only (no gap joins): the caller drills into one via GET /:id. */
export const learningPlanSummarySchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  reviewStatus: planReviewStatusSchema,
  gapCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type LearningPlanSummary = z.infer<typeof learningPlanSummarySchema>;

export const learningPlanListResponseSchema = z.strictObject({
  plans: z.array(learningPlanSummarySchema),
});
export type LearningPlanListResponse = z.infer<typeof learningPlanListResponseSchema>;

/** Cost-free sanity bound on review notes (the plan review precedent: a text
 *  column, escaped on render, ~10x a long real note). */
export const LEARNING_PLAN_REVIEW_NOTES_MAX_CHARS = 10_000;

// A Postgres text column rejects U+0000 outright — reject at the boundary for
// a value-free 400 instead of a 500 (the plan review notes precedent).
const notesNoNul = (value: string) => !value.includes('\u0000');

/**
 * POST /learning-plans/:id/review — the one-shot draft→reviewed action (CAS
 * on review_status='draft'; the M1-12 precedent, a named deviation from the
 * ARCHITECTURE §5 PATCH row that improvement-plan already documented). `notes`
 * is nullish (a body-less POST reaches the validator as null); values that
 * trim to empty are stored as NULL at the service boundary.
 */
export const learningPlanReviewBodySchema = z.strictObject({
  notes: z
    .string()
    .max(LEARNING_PLAN_REVIEW_NOTES_MAX_CHARS)
    .refine(notesNoNul, 'must not contain U+0000')
    .nullish(),
});
export type LearningPlanReviewBody = z.infer<typeof learningPlanReviewBodySchema>;

/** Review response is meta-only (no joins): the caller already renders the
 *  plan; this confirms the workflow-field transition. */
export const learningPlanReviewResponseSchema = z.strictObject({
  id: z.string(),
  reviewStatus: planReviewStatusSchema,
  notes: z.string().nullable(),
});
export type LearningPlanReviewResponse = z.infer<typeof learningPlanReviewResponseSchema>;
