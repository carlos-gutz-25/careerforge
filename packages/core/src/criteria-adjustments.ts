import { z } from 'zod';

import {
  criteriaResponseSchema,
  slugSchema,
  SIGNAL_CATEGORIES,
  type SearchCriteriaData,
  type SignalCategory,
} from './criteria.ts';
import { applicationStageSchema } from './enums.ts';

// M4-02 — Outcomes → matching feedback. Application outcomes (screens /
// rejections / offers) produce SUGGESTED search-criteria adjustments, shown with
// their supporting 2×2 evidence, applied only on explicit confirmation (human in
// the loop). DETERMINISTIC and CLOCK-FREE — NO LLM (the M3-06 / M4-01 class);
// the pure engine lives in packages/scoring, these are its wire contracts.
//
// The defining interpretive move (OD-1): `search_criteria` has NO numeric
// weights, so the AC's "weight adjustments" honestly translates to REMOVAL-ONLY
// edits over slugs Carlos already authored. The system never invents vocabulary
// (closed-vocabulary law) and never touches `hardFilters` (survivorship:
// excluded postings generate no outcome data; the M1-08 cap-never-exclude law
// bars exclusionary edits). Two kinds only, both removals.

/** The two adjustment kinds — both are REMOVALS of an existing slug. Array
 *  order is the primary determinism key for suggestion ordering. */
export const CRITERIA_ADJUSTMENT_KINDS = [
  'remove_positive_signal',
  'remove_negative_signal',
] as const;
export const criteriaAdjustmentKindSchema = z.enum(CRITERIA_ADJUSTMENT_KINDS);
export type CriteriaAdjustmentKind = z.infer<typeof criteriaAdjustmentKindSchema>;

/** The `increase_score_for` category a positive-signal adjustment targets;
 *  reuses the closed criteria vocabulary (never a free string). */
export const signalCategorySchema = z.enum(SIGNAL_CATEGORIES);

/** One outcome for a matched-cohort application: it either reached a screen
 *  (`progressed`) or resolved as a rejection before a screen. There is no third
 *  value — an analyzable application is resolved by construction, and a resolved
 *  application either progressed or was rejected-before-screen. */
export const CRITERIA_ADJUSTMENT_OUTCOMES = ['progressed', 'rejected_before_screen'] as const;
export const criteriaAdjustmentOutcomeSchema = z.enum(CRITERIA_ADJUSTMENT_OUTCOMES);
export type CriteriaAdjustmentOutcome = z.infer<typeof criteriaAdjustmentOutcomeSchema>;

/** One 2×2 cell: how many analyzable applications fell in it, and how many of
 *  those progressed. Non-negative integers only (no floats anywhere — rate
 *  comparisons use integer cross-multiplication). */
export const criteriaAdjustmentCellSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  progressed: z.number().int().nonnegative(),
});
export type CriteriaAdjustmentCell = z.infer<typeof criteriaAdjustmentCellSchema>;

/**
 * One matched-cohort application in a suggestion's evidence — the human's ONLY
 * spot-check surface for the inherited phraseMatches false-match residual (see
 * suggest-criteria-adjustments.ts). Ids + user-curated company/title + the
 * reached stage + the binary outcome; NO requirement text or posting quotes ever
 * (structured-only wire, OD-4).
 */
export const criteriaAdjustmentPostingSchema = z.strictObject({
  applicationId: z.string(),
  postingId: z.string(),
  company: z.string().nullable(),
  title: z.string().nullable(),
  furthestStage: applicationStageSchema,
  outcome: criteriaAdjustmentOutcomeSchema,
});
export type CriteriaAdjustmentPosting = z.infer<typeof criteriaAdjustmentPostingSchema>;

/** The 2×2 evidence backing one suggestion: matched vs unmatched cohort counts
 *  plus the matched applications enumerated for spot-checking. */
export const criteriaAdjustmentEvidenceSchema = z.strictObject({
  matched: criteriaAdjustmentCellSchema,
  unmatched: criteriaAdjustmentCellSchema,
  matchedPostings: z.array(criteriaAdjustmentPostingSchema),
});
export type CriteriaAdjustmentEvidence = z.infer<typeof criteriaAdjustmentEvidenceSchema>;

/**
 * `category` is non-null IFF the kind is `remove_positive_signal` — a
 * negative-signal adjustment targets the flat `decreaseScoreFor` list, which has
 * no category. The superRefine makes the illegal combinations unrepresentable at
 * the boundary (structural, not a runtime check the engine must remember).
 */
const refineCategoryByKind = (
  value: { kind: CriteriaAdjustmentKind; category: SignalCategory | null },
  ctx: z.RefinementCtx,
): void => {
  const requiresCategory = value.kind === 'remove_positive_signal';
  if (requiresCategory && value.category === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['category'],
      message: 'remove_positive_signal requires a category',
    });
  }
  if (!requiresCategory && value.category !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['category'],
      message: 'remove_negative_signal must not carry a category',
    });
  }
};

/**
 * A deterministically-derived suggestion for GET /criteria-suggestions
 * (recomputed per request — nothing stored, nothing stale). Identity is the
 * natural composite `(kind, category|null, slug)` — no hash (the M3-06
 * natural-id precedent).
 */
export const criteriaAdjustmentSuggestionSchema = z
  .strictObject({
    kind: criteriaAdjustmentKindSchema,
    category: signalCategorySchema.nullable(),
    slug: slugSchema,
    evidence: criteriaAdjustmentEvidenceSchema,
  })
  .superRefine(refineCategoryByKind);
export type CriteriaAdjustmentSuggestion = z.infer<typeof criteriaAdjustmentSuggestionSchema>;

/** Every excluded population is DISCLOSED (honesty-first): the denominator is
 *  resolved-analyzable only, and each reason a posting is not in it is counted. */
export const criteriaSuggestionTotalsSchema = z.strictObject({
  applications: z.number().int().nonnegative(),
  exposed: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  analyzable: z.number().int().nonnegative(),
  inFlight: z.number().int().nonnegative(),
  withdrawnCensored: z.number().int().nonnegative(),
  withoutRequirements: z.number().int().nonnegative(),
});
export type CriteriaSuggestionTotals = z.infer<typeof criteriaSuggestionTotalsSchema>;

/** The trigger thresholds, disclosed on the wire (firing rarely is honest —
 *  the UI shows exactly what the data must clear). */
export const criteriaSuggestionThresholdsSchema = z.strictObject({
  minResolvedAnalyzable: z.number().int().positive(),
  minMatchedCell: z.number().int().positive(),
  minUnmatchedCell: z.number().int().positive(),
  minCounterProgressed: z.number().int().positive(),
});
export type CriteriaSuggestionThresholds = z.infer<typeof criteriaSuggestionThresholdsSchema>;

export const CRITERIA_SUGGESTION_STATUSES = ['ok', 'insufficient_data'] as const;
export const criteriaSuggestionStatusSchema = z.enum(CRITERIA_SUGGESTION_STATUSES);
export type CriteriaSuggestionStatus = z.infer<typeof criteriaSuggestionStatusSchema>;

/**
 * GET /criteria-suggestions (200 always). `insufficient_data` = the analyzable
 * cohort is below `minResolvedAnalyzable`: totals + thresholds ride along, zero
 * suggestions, and the UI shows no near-miss display. `criteriaUpdatedAt` rides
 * with the view so the confirm pin (below) comes from the SAME coherent read;
 * it is null before the first criteria import/PUT.
 */
export const criteriaSuggestionsResponseSchema = z.strictObject({
  status: criteriaSuggestionStatusSchema,
  criteriaUpdatedAt: z.iso.datetime().nullable(),
  totals: criteriaSuggestionTotalsSchema,
  thresholds: criteriaSuggestionThresholdsSchema,
  suggestions: z.array(criteriaAdjustmentSuggestionSchema),
});
export type CriteriaSuggestionsResponse = z.infer<typeof criteriaSuggestionsResponseSchema>;

/**
 * POST /criteria-adjustments — confirm and apply a suggestion. Zero client
 * trust: the client sends only the natural id + the criteria pin it last saw;
 * the server RE-DERIVES the full suggestion list from current DB state and 409s
 * if this triple is not derivable (drift, new outcomes, min(1), fabricated key).
 * `expectedUpdatedAt` is the compare-and-swap pin — the same value GET returned
 * as `criteriaUpdatedAt` — so a criteria change between view and confirm is a
 * 409, never a blind overwrite (the PUT /criteria CAS precedent).
 */
export const confirmCriteriaAdjustmentBodySchema = z
  .strictObject({
    kind: criteriaAdjustmentKindSchema,
    category: signalCategorySchema.nullable(),
    slug: slugSchema,
    expectedUpdatedAt: z.iso.datetime(),
  })
  .superRefine(refineCategoryByKind);
export type ConfirmCriteriaAdjustmentBody = z.infer<typeof confirmCriteriaAdjustmentBodySchema>;

/**
 * One persisted adjustment on the wire (POST 201's `adjustment`, GET
 * /criteria-adjustments list). The frozen `evidence` is exactly what was seen at
 * confirm time. `criteriaBefore`/`criteriaAfter` are DELIBERATELY absent from
 * the wire: they are DB-only audit truth (private criteria payloads), never
 * re-served — the list shows what changed (kind/category/slug) and why
 * (evidence), which is the audit surface a human needs.
 */
export const criteriaAdjustmentRecordSchema = z.strictObject({
  id: z.string(),
  kind: criteriaAdjustmentKindSchema,
  category: signalCategorySchema.nullable(),
  slug: slugSchema,
  evidence: criteriaAdjustmentEvidenceSchema,
  createdAt: z.iso.datetime(),
});
export type CriteriaAdjustmentRecord = z.infer<typeof criteriaAdjustmentRecordSchema>;

/** POST /criteria-adjustments (201): the persisted adjustment plus the updated
 *  criteria (carrying the advanced pin — the next confirm's expectedUpdatedAt). */
export const confirmCriteriaAdjustmentResponseSchema = z.strictObject({
  adjustment: criteriaAdjustmentRecordSchema,
  criteria: criteriaResponseSchema,
});
export type ConfirmCriteriaAdjustmentResponse = z.infer<
  typeof confirmCriteriaAdjustmentResponseSchema
>;

/** GET /criteria-adjustments (200) — the append-only audit list (newest first). */
export const criteriaAdjustmentsResponseSchema = z.strictObject({
  adjustments: z.array(criteriaAdjustmentRecordSchema),
});
export type CriteriaAdjustmentsResponse = z.infer<typeof criteriaAdjustmentsResponseSchema>;

/** The natural-id triple identifying a suggestion/adjustment target. */
export interface CriteriaAdjustmentTarget {
  kind: CriteriaAdjustmentKind;
  category: SignalCategory | null;
  slug: string;
}

/**
 * THE one applier definition (OD): apply a removal to a criteria document,
 * returning the new document — or `undefined` when the edit is not applicable
 * (the slug is absent from its target list, OR removing it would empty a
 * min(1)-guarded list). Generation, confirm, and tests all route through this
 * one function, so "what a suggestion does when applied" has a single home and
 * every emitted suggestion is provably re-parseable under `searchCriteriaSchema`
 * (a slice-1 property test pins exactly that). Pure — no clock, no I/O.
 */
export function applyCriteriaAdjustment(
  criteria: SearchCriteriaData,
  target: CriteriaAdjustmentTarget,
): SearchCriteriaData | undefined {
  if (target.kind === 'remove_positive_signal') {
    // Defensive: the schema makes a null category unrepresentable here, but the
    // applier is also called from the engine's own target objects.
    if (target.category === null) return undefined;
    const current = criteria.positiveSignals[target.category];
    if (!current.includes(target.slug)) return undefined;
    const next = current.filter((slug) => slug !== target.slug);
    if (next.length === 0) return undefined; // min(1) guard — emptying is unrepresentable
    return {
      ...criteria,
      positiveSignals: { ...criteria.positiveSignals, [target.category]: next },
    };
  }
  // remove_negative_signal — the flat decreaseScoreFor list, no category.
  if (target.category !== null) return undefined;
  const current = criteria.negativeSignals;
  if (!current.includes(target.slug)) return undefined;
  const next = current.filter((slug) => slug !== target.slug);
  if (next.length === 0) return undefined; // min(1) guard
  return { ...criteria, negativeSignals: next };
}
