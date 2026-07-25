import { z } from 'zod';

import {
  evidenceStrengthSchema,
  gapClassificationSchema,
  interviewPointTypeSchema,
  interviewQuestionKindSchema,
  planDraftingRunStatusSchema,
  planReviewStatusSchema,
  requirementCategorySchema,
  requirementKindSchema,
} from './enums.ts';

// Wire contracts for POST/GET /postings/:id/interview-prep and
// POST /interview-preps/:id/review (M3-04). A prep is an LLM-DRAFTED,
// append-only artifact of exactly ONE fit report (pin-to-report; UNIQUE
// fit_report_id — the M1-12 pattern, NOT ADR-0013's free-create) reached
// through the POSTING: the route resolves the posting's LATEST fit report
// and requires it reviewed. Draft-until-reviewed (ADR-0005 §3). Two values
// NEVER cross the wire: `raw_response` (audit/replay only) and `user_id`.
// Per-run usage IS on the wire deliberately (RISKS T-03). Question and point
// text are LLM-generated and the joined display fields are posting-derived —
// all UNTRUSTED on display (escaped, never rendered as HTML/markdown —
// RISKS S-02).

// Drafting caps, shared by the LLM output schema (packages/llm) and the
// tests: cost + sanity bounds well above any useful real prep.
export const INTERVIEW_PREP_MAX_QUESTIONS = 15;
export const INTERVIEW_PREP_MAX_POINTS_PER_QUESTION = 4;
/** One bound for every model-drafted text field (question + point text). */
export const INTERVIEW_PREP_TEXT_MAX_CHARS = 400;

/** One drafting wire call on the wire — the PlanDraftingRun twin (M1-05 law
 *  at its fourth call site), one row per wire call. */
export const interviewPrepRunSchema = z.strictObject({
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
export type InterviewPrepRun = z.infer<typeof interviewPrepRunSchema>;

/** Read-time pointer to a learning plan citing the disclosed gap (via
 *  learning_plan_gaps) — computed on every read, never stored, never
 *  LLM-visible. An empty list is itself the honest "not yet planned". */
export const interviewLearningPlanPointerSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
});
export type InterviewLearningPlanPointer = z.infer<typeof interviewLearningPlanPointerSchema>;

/**
 * An `evidence` talking point with its cited evidence link's display fields
 * joined per row (one fetch renders the section — the planItemResponseSchema
 * precedent). The link belongs to THIS question's requirement by tripwire
 * (cross-requirement bleed flags the run) and by FK at rest.
 */
export const interviewPrepEvidencePointSchema = z.strictObject({
  id: z.string(),
  type: z.literal(interviewPointTypeSchema.enum.evidence),
  text: z.string(),
  position: z.number().int().min(0),
  evidenceLinkId: z.string(),
  evidenceStrength: evidenceStrengthSchema,
  evidencePostingQuote: z.string(),
  evidenceProfileQuote: z.string(),
});
export type InterviewPrepEvidencePoint = z.infer<typeof interviewPrepEvidencePointSchema>;

/**
 * A `gap_disclosure` talking point. `gapClassification` is the gap row's
 * LIVE effective value, server-resolved on every read — the AUTHORITATIVE
 * honesty signal the UI badges from; the model's `text` is supplementary
 * prose, never the source of truth (M3-04 gate condition 3). `learningPlans`
 * is the deterministic read-time pointer (never LLM-emitted).
 */
export const interviewPrepGapDisclosurePointSchema = z.strictObject({
  id: z.string(),
  type: z.literal(interviewPointTypeSchema.enum.gap_disclosure),
  text: z.string(),
  position: z.number().int().min(0),
  gapId: z.string(),
  gapClassification: gapClassificationSchema,
  learningPlans: z.array(interviewLearningPlanPointerSchema),
});
export type InterviewPrepGapDisclosurePoint = z.infer<typeof interviewPrepGapDisclosurePointSchema>;

export const interviewPrepPointSchema = z.discriminatedUnion('type', [
  interviewPrepEvidencePointSchema,
  interviewPrepGapDisclosurePointSchema,
]);
export type InterviewPrepPoint = z.infer<typeof interviewPrepPointSchema>;

/**
 * One drafted question with its requirement's display fields joined per row.
 * `requirementId` is the structural citation (FK at rest): a question always
 * targets a SENT, quote-verified requirement — a fabricated ref never reaches
 * this shape (the run flags instead). Points in model output order
 * (position, id).
 */
export const interviewPrepQuestionSchema = z.strictObject({
  id: z.string(),
  kind: interviewQuestionKindSchema,
  question: z.string(),
  position: z.number().int().min(0),
  requirementId: z.string(),
  requirementText: z.string(),
  requirementKind: requirementKindSchema,
  requirementCategory: requirementCategorySchema,
  points: z.array(interviewPrepPointSchema),
});
export type InterviewPrepQuestion = z.infer<typeof interviewPrepQuestionSchema>;

/** One interview prep on the wire, questions in model output order
 *  (position, id). `notes` is null until review captures them. */
export const interviewPrepSchema = z.strictObject({
  id: z.string(),
  fitReportId: z.string(),
  reviewStatus: planReviewStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  questions: z.array(interviewPrepQuestionSchema),
});
export type InterviewPrep = z.infer<typeof interviewPrepSchema>;

/**
 * GET /postings/:id/interview-prep (and the POST result shape), keyed to the
 * posting's LATEST fit report. `prep: null` = not yet drafted — an empty
 * collection, not a 404. Run-selection contract (the M1-12 R2 precedent):
 * when `prep` is non-null, `run` IS the prep's drafting run (via
 * drafting_run_id) — never latest-by-time; latest-by-time applies ONLY when
 * `prep` is null (failure display). 201 = a fresh draft ran and its run
 * row(s) were appended — including non-ok terminal outcomes, which are
 * results, not transport errors (`run.status` is the discriminant and `prep`
 * is null). 200 with `cached: true` = the report's existing prep served with
 * no LLM call (UNIQUE fit_report_id; regeneration = re-score).
 */
export const interviewPrepResponseSchema = z.strictObject({
  run: interviewPrepRunSchema.nullable(),
  prep: interviewPrepSchema.nullable(),
  cached: z.boolean(),
});
export type InterviewPrepResponse = z.infer<typeof interviewPrepResponseSchema>;

/** Cost-free sanity bound on prep review notes (text column, escaped on
 *  render; ~10x a long real note — the plan review precedent). */
export const INTERVIEW_PREP_REVIEW_NOTES_MAX_CHARS = 10_000;

// A Postgres text column rejects U+0000 outright — reject at the boundary
// for a value-free 400 instead of a 500 (the plan review notes precedent).
const notesNoNul = (value: string) => !value.includes('\u0000');

/**
 * POST /interview-preps/:id/review — the one-shot draft→reviewed action (CAS
 * on review_status='draft'; the M1-10 A2 precedent, fourth application).
 * `notes` is nullish (a body-less POST reaches the validator as null);
 * values that trim to empty are stored as NULL at the service boundary.
 */
export const interviewPrepReviewBodySchema = z.strictObject({
  notes: z
    .string()
    .max(INTERVIEW_PREP_REVIEW_NOTES_MAX_CHARS)
    .refine(notesNoNul, 'must not contain U+0000')
    .nullish(),
});
export type InterviewPrepReviewBody = z.infer<typeof interviewPrepReviewBodySchema>;

/** Review response is meta-only (no joins): the caller already renders the
 *  prep; this confirms the workflow-field transition. */
export const interviewPrepReviewResponseSchema = z.strictObject({
  id: z.string(),
  reviewStatus: planReviewStatusSchema,
  notes: z.string().nullable(),
});
export type InterviewPrepReviewResponse = z.infer<typeof interviewPrepReviewResponseSchema>;
