import { z } from 'zod';

// Canonical shapes for search_criteria (M1-08): ONE set of zod contracts
// validates the criteria importer's parse output, the PUT /criteria body,
// and packages/db's jsonb column $types — file, wire, and DB can never
// disagree. Key names inside the payloads keep the YAML vocabulary of
// docs/profile.example/job-criteria.md (snake_case, 1:1 traceability with
// the source document); the wire field names around them are camelCase.
// All object schemas are strict: an unknown key is a validation error,
// never silently dropped data.

/** Criteria vocabulary values: lowercase_snake slugs, nothing else.
 *  (Exported since M1-09: fit contracts reuse it for matched-slug lists.) */
export const slugSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'expected a lowercase_snake slug');

/**
 * `onsite_requirement` keys are PATTERN-validated, not enumerated: the metro
 * name is profile data (the example file uses a fictional metro), so no real
 * metro slug may ever appear in committed schema code (RISKS P-01).
 */
const ONSITE_REQUIREMENT_KEY = /^(outside_[a-z][a-z0-9_]*_metro|without_relocation_support)$/;

const nonEmptyRecord = (value: Record<string, unknown>) => Object.keys(value).length > 0;

/**
 * `exclude_when`, normalized from the YAML list of entries to one record.
 * The key set is CLOSED (M1-08 domain law): scoring vocabularies —
 * problem_domains, technologies, role — are NOT here and cannot be smuggled
 * in as data; re-introducing a domain (e.g. payments/fintech) as a
 * dealbreaker requires a reviewed schema change. Hard filters produce an
 * explicit exclusion verdict in scoring (M1-09), never a silent low score.
 */
export const hardFiltersSchema = z
  .strictObject({
    base_salary_max_is_known_and_below: z.number().int().positive().optional(),
    compensation_type: z.literal('equity_only').optional(),
    employment_type: z.array(slugSchema).min(1).optional(),
    seniority: z.array(slugSchema).min(1).optional(),
    onsite_requirement: z
      .record(z.string().regex(ONSITE_REQUIREMENT_KEY), z.boolean())
      .refine(nonEmptyRecord, 'onsite_requirement must contain at least one key')
      .optional(),
    primary_function: z.array(slugSchema).min(1).optional(),
    industry: z.array(slugSchema).min(1).optional(),
  })
  .refine(nonEmptyRecord, 'exclude_when must contain at least one filter');
export type HardFilters = z.infer<typeof hardFiltersSchema>;

/**
 * The closed exclude_when key set as a value (M1-09): exclusion evaluators
 * enumerate it, and ExclusionVerdict.filterKey is drawn from it — an
 * exclusion can only ever cite a key this schema admits. `satisfies` pins
 * every listed key to the schema; the completeness pin (no schema key
 * missing from the list) is a named test in fit.test.ts.
 */
export const HARD_FILTER_KEYS = [
  'base_salary_max_is_known_and_below',
  'compensation_type',
  'employment_type',
  'seniority',
  'onsite_requirement',
  'primary_function',
  'industry',
] as const satisfies readonly (keyof HardFilters)[];
export const hardFilterKeySchema = z.enum(HARD_FILTER_KEYS);
export type HardFilterKey = z.infer<typeof hardFilterKeySchema>;

/** `increase_score_for` categories — closed set; adding one is a code change
 *  (M1-09's scoring must know how to weight it), never silent data. */
export const SIGNAL_CATEGORIES = [
  'role',
  'technologies',
  'problem_domains',
  'work_arrangement',
  'scope',
] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

/** `increase_score_for`: every category present, each a non-empty slug list. */
export const positiveSignalsSchema = z.strictObject({
  role: z.array(slugSchema).min(1),
  technologies: z.array(slugSchema).min(1),
  problem_domains: z.array(slugSchema).min(1),
  work_arrangement: z.array(slugSchema).min(1),
  scope: z.array(slugSchema).min(1),
});
export type PositiveSignals = z.infer<typeof positiveSignalsSchema>;

/** `decrease_score_for`: a flat slug list. */
export const negativeSignalsSchema = z.array(slugSchema).min(1);
export type NegativeSignals = z.infer<typeof negativeSignalsSchema>;

/**
 * `force_lowest_priority`, normalized from the YAML list of single-key maps.
 * SEMANTICS LAW (M1-08): this is a CAP to the bottom tier, NEVER an
 * exclusion — consumers (M1-09 scoring, tiering) rank matching roles last
 * but must not reject them. It deliberately lives beside hardFilters, not
 * inside it. Closed category set: `industry` only, for now.
 */
export const forceLowestPrioritySchema = z.strictObject({
  industry: z.array(slugSchema),
});
export type ForceLowestPriority = z.infer<typeof forceLowestPrioritySchema>;

/**
 * `comp_bounds`: scoring-range preferences ONLY. The hard salary floor is
 * deliberately absent — `exclude_when.base_salary_max_is_known_and_below`
 * is its single source of truth, so the two can never drift.
 */
export const compBoundsSchema = z
  .strictObject({
    currency: z.literal('usd'),
    base_preferred_min: z.number().int().positive(),
    base_preferred_max: z.number().int().positive(),
    total_preferred_min: z.number().int().positive().optional(),
    total_preferred_max: z.number().int().positive().optional(),
  })
  .superRefine((bounds, ctx) => {
    if (bounds.base_preferred_min > bounds.base_preferred_max) {
      ctx.addIssue({
        code: 'custom',
        path: ['base_preferred_min'],
        message: 'base_preferred_min must not exceed base_preferred_max',
      });
    }
    const hasTotalMin = bounds.total_preferred_min !== undefined;
    const hasTotalMax = bounds.total_preferred_max !== undefined;
    if (hasTotalMin !== hasTotalMax) {
      ctx.addIssue({
        code: 'custom',
        path: [hasTotalMin ? 'total_preferred_max' : 'total_preferred_min'],
        message: 'total_preferred_min and total_preferred_max must appear together',
      });
    } else if (
      bounds.total_preferred_min !== undefined &&
      bounds.total_preferred_max !== undefined &&
      bounds.total_preferred_min > bounds.total_preferred_max
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['total_preferred_min'],
        message: 'total_preferred_min must not exceed total_preferred_max',
      });
    }
  });
export type CompBounds = z.infer<typeof compBoundsSchema>;

/** The five criteria mechanisms — the search_criteria row's jsonb payload. */
export const searchCriteriaSchema = z.strictObject({
  hardFilters: hardFiltersSchema,
  positiveSignals: positiveSignalsSchema,
  negativeSignals: negativeSignalsSchema,
  forceLowestPriority: forceLowestPrioritySchema,
  compBounds: compBoundsSchema,
});
export type SearchCriteriaData = z.infer<typeof searchCriteriaSchema>;

/** Wire contract for GET /criteria (values are private profile data: they
 *  travel this authenticated response only — never logs, never CLI output). */
export const criteriaResponseSchema = searchCriteriaSchema.extend({
  updatedAt: z.iso.datetime(),
});
export type CriteriaResponse = z.infer<typeof criteriaResponseSchema>;

/**
 * Wire contract for PUT /criteria: full-document replace, compare-and-swap.
 * `expectedUpdatedAt: null` = create (a row already existing is a 409);
 * an ISO timestamp = replace iff the row's updatedAt still matches (stale
 * view is a 409, postings-transition analog — never a blind overwrite).
 */
export const criteriaPutBodySchema = searchCriteriaSchema.extend({
  expectedUpdatedAt: z.iso.datetime().nullable(),
});
export type CriteriaPutBody = z.infer<typeof criteriaPutBodySchema>;
