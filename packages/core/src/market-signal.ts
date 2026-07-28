import { z } from 'zod';

import { gapClassificationSchema, requirementCategorySchema } from './enums.ts';

// M9-02 (V2-PLAN 3.5): wire contracts for the market-signal aggregation report -
// the 200 body of GET /market-signal. Core owns the wire; packages/scoring owns the
// deterministic engine + its input/result TYPES (the ats-coverage / suggest-criteria
// precedent). Every field is a COUNT or the engine's evidence-weight currency; NO
// field aggregates across factors into a single "market score" - the z.strictObject
// walls forbid smuggling one in (the never-one-merged-score lineage). The honesty
// string on the report IS the claim ceiling: recurrence arithmetic over the user's
// own saved postings, never a market prediction. All display strings (key,
// displayText, matchedTerms) are posting-derived UNTRUSTED data - served as data,
// escaped by the UI, never rendered as HTML/markdown.

/** A gap.id link back into learning plans / exercises (V2-PLAN "links via gaps.id"). */
export const marketSignalRefSchema = z.strictObject({
  gapId: z.string(),
  postingId: z.string(),
  fitReportId: z.string(),
  classification: gapClassificationSchema,
});
export type MarketSignalRef = z.infer<typeof marketSignalRefSchema>;

/** The certification-mention probe: keyword evidence + counts, never advice
 *  (ADR-0017). `postingCount` = distinct non-excluded mentioning postings. */
export const marketSignalCertificationSchema = z.strictObject({
  mentioned: z.boolean(),
  postingCount: z.number().int().min(0),
  matchedTerms: z.array(z.string()),
});
export type MarketSignalCertification = z.infer<typeof marketSignalCertificationSchema>;

/** Counts per gap classification - all five keys always present (honesty: user
 *  overrides stay visible via overriddenCount + the full split). */
export const marketSignalClassificationCountsSchema = z.strictObject({
  have: z.number().int().min(0),
  have_undemonstrated: z.number().int().min(0),
  needs_refresh: z.number().int().min(0),
  genuine_gap: z.number().int().min(0),
  low_priority: z.number().int().min(0),
});
export type MarketSignalClassificationCounts = z.infer<
  typeof marketSignalClassificationCountsSchema
>;

/** One recurrence group. Evidence weights are the engine's own EVIDENCE_WEIGHTS
 *  currency (0..1), never a recomputed fit score. */
export const marketSignalGroupSchema = z.strictObject({
  key: z.string(),
  displayText: z.string(),
  postingCount: z.number().int().min(0),
  instanceCount: z.number().int().min(0),
  mustHavePostingCount: z.number().int().min(0),
  niceToHavePostingCount: z.number().int().min(0),
  excludedPostingCount: z.number().int().min(0),
  bestEvidenceWeight: z.number(),
  meanEvidenceWeight: z.number(),
  classificationCounts: marketSignalClassificationCountsSchema,
  overriddenCount: z.number().int().min(0),
  categories: z.array(requirementCategorySchema),
  refs: z.array(marketSignalRefSchema),
  certification: marketSignalCertificationSchema,
});
export type MarketSignalGroup = z.infer<typeof marketSignalGroupSchema>;

/** Why a grouped skill takes no action (D4): nothing actionable, or every
 *  demanding posting is hard-filtered out. */
export const marketSignalNoActionReasonSchema = z.enum([
  'covered_or_low_priority',
  'all_postings_excluded',
]);
export type MarketSignalNoActionReason = z.infer<typeof marketSignalNoActionReasonSchema>;

/** A group carrying its noAction reason (still fully reported). */
export const marketSignalNoActionSchema = marketSignalGroupSchema.extend({
  reason: marketSignalNoActionReasonSchema,
});
export type MarketSignalNoActionGroup = z.infer<typeof marketSignalNoActionSchema>;

/** The Sharpen / Prove / Build / Certify buckets (V2-PLAN 3.5). */
export const marketSignalBucketsSchema = z.strictObject({
  sharpen: z.array(marketSignalGroupSchema),
  prove: z.array(marketSignalGroupSchema),
  build: z.array(marketSignalGroupSchema),
  certify: z.array(marketSignalGroupSchema),
});
export type MarketSignalBuckets = z.infer<typeof marketSignalBucketsSchema>;

/** The cohort disclosure (D5): every posting the signal did and did NOT draw from,
 *  counted, never silent (the M4-02 full-disclosure discipline). */
export const marketSignalCohortSchema = z.strictObject({
  postingsConsidered: z.number().int().min(0),
  postingsWithSignal: z.number().int().min(0),
  postingsWithoutReport: z.number().int().min(0),
  postingsArchived: z.number().int().min(0),
  excludedVerdictPostings: z.number().int().min(0),
  draftReports: z.number().int().min(0),
  reviewedReports: z.number().int().min(0),
  unscoredRequirementsInCohort: z.number().int().min(0),
});
export type MarketSignalCohort = z.infer<typeof marketSignalCohortSchema>;

/** The market-signal report (200 of GET /market-signal). Counts only + the pinned
 *  honesty ceiling; scorerVersion is the reproducibility anchor (nothing persisted). */
export const marketSignalReportSchema = z.strictObject({
  scorerVersion: z.number().int(),
  honesty: z.string(),
  cohort: marketSignalCohortSchema,
  buckets: marketSignalBucketsSchema,
  noAction: z.array(marketSignalNoActionSchema),
  groupCount: z.number().int().min(0),
  instanceCount: z.number().int().min(0),
});
export type MarketSignalReport = z.infer<typeof marketSignalReportSchema>;
