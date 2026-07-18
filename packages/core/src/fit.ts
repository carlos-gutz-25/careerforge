import { z } from 'zod';

import { hardFilterKeySchema, searchCriteriaSchema, slugSchema } from './criteria.ts';
import {
  evidenceStrengthSchema,
  FIT_DIMENSIONS,
  fitVerdictSchema,
  fitDimensionSchema,
  REQUIREMENT_BEARING_STATUSES,
  unscoredRequirementReasonSchema,
} from './enums.ts';
import { requirementSchema } from './extractions.ts';
import { profileResponseSchema } from './profile.ts';

// Canonical shapes for the deterministic fit engine (M1-09): ONE set of zod
// contracts validates the engine's output (packages/scoring scoreFit), the
// persisted jsonb payloads (packages/db fit_reports $types), and — in M1-10 —
// the wire report, so engine, DB, and wire can never disagree (the M1-08
// criteria.ts pattern). Everything here is rule-generated from verified
// inputs; nothing is LLM-derived. Posting-derived quote fields are UNTRUSTED
// on display, exactly like rawText (RISKS S-02).

/**
 * Engine input row: the wire Requirement plus its persisted position. The
 * wire shape deliberately omits position (wire arrays are already served in
 * position order), but the engine canonicalizes internally by (position, id)
 * before any processing — determinism over input sets, not arrays — so its
 * input must carry it.
 */
export const scoringRequirementSchema = requirementSchema.extend({
  position: z.number().int().min(0),
});
export type ScoringRequirement = z.infer<typeof scoringRequirementSchema>;

/**
 * The engine's whole input, validated at entry (scoreFit parses this): ONE
 * requirement-bearing run's rows, the profile, the criteria (all five M1-08
 * mechanisms), and `referenceDate` — the ONLY time input, an ISO date the
 * CALLER supplies from the database clock (PG now(), the one-clock
 * convention). The engine itself never touches a clock; the seniority
 * rationale states this date so every report stays self-explaining.
 */
export const fitInputSchema = z.strictObject({
  requirements: z.array(scoringRequirementSchema),
  runStatus: z.enum(REQUIREMENT_BEARING_STATUSES),
  profile: profileResponseSchema,
  criteria: searchCriteriaSchema,
  referenceDate: z.iso.date(),
});
export type FitInput = z.infer<typeof fitInputSchema>;

/**
 * One fired hard filter (M1-08 domain law: an EXPLICIT exclusion verdict,
 * never a silent low score). Conservative-evidence law (D6): a filter fires
 * only on affirmative, quote-citable evidence — postingQuote is required by
 * shape, so a quote-free exclusion is unrepresentable. `matchedValue` is the
 * human-readable rendering of what matched (a criteria slug or a parsed
 * figure); with criteria data it is private-profile-adjacent and travels
 * authenticated surfaces only.
 */
export const exclusionVerdictSchema = z.strictObject({
  filterKey: hardFilterKeySchema,
  matchedValue: z.string().min(1),
  postingQuote: z.string().min(1),
});
export type ExclusionVerdict = z.infer<typeof exclusionVerdictSchema>;

/**
 * Evidence from BOTH sides (story AC): the verified posting quote and a
 * rule-generated profile quote. Profile pointers are nullable — the quotes
 * are the durable evidence; ids are navigation. Strength law, structural:
 * `direct`/`partial` are by definition named-skill matches (profileSkillId
 * required); `adjacent` is by definition NOT one (profileSkillId null; the
 * evidence lives in experience/project text).
 */
export const evidenceLinkSchema = z
  .strictObject({
    requirementId: z.string(),
    profileSkillId: z.string().nullable(),
    profileProjectId: z.string().nullable(),
    profileExperienceId: z.string().nullable(),
    postingQuote: z.string().min(1),
    profileQuote: z.string().min(1),
    strength: evidenceStrengthSchema,
  })
  .superRefine((link, ctx) => {
    const named = link.profileSkillId !== null;
    if (link.strength === 'adjacent' ? named : !named) {
      ctx.addIssue({
        code: 'custom',
        path: ['profileSkillId'],
        message:
          link.strength === 'adjacent'
            ? 'adjacent evidence must not name a profile skill (that would be direct/partial)'
            : `${link.strength} evidence requires a named profile skill`,
      });
    }
  });
export type EvidenceLink = z.infer<typeof evidenceLinkSchema>;

/** One dimension's result: score 0..1, deterministic templated rationale,
 *  and the evidence rows behind it. */
export const subScoreSchema = z.strictObject({
  dimension: fitDimensionSchema,
  score: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidence: z.array(evidenceLinkSchema),
});
export type SubScore = z.infer<typeof subScoreSchema>;

/**
 * The force_lowest_priority outcome (D8, flag never clamp): the priority
 * sub-score is computed honestly from signals; THIS flag plus one rationale
 * sentence carry the policy, and M1-10's ranking consumes it. A cap, never
 * an exclusion (M1-08 semantics law). `applied` mirrors matchedSlugs by
 * refinement so the two can never disagree at rest.
 */
export const forcedLowestSchema = z
  .strictObject({
    applied: z.boolean(),
    matchedSlugs: z.array(slugSchema),
  })
  .refine((value) => value.applied === value.matchedSlugs.length > 0, {
    message: 'applied must be true exactly when matchedSlugs is non-empty',
    path: ['applied'],
  });
export type ForcedLowest = z.infer<typeof forcedLowestSchema>;

/** A requirement row ineligible for scoring, with its verification-state
 *  reason (D3 pre-registration; distinct reason per state). */
export const unscoredRequirementSchema = z.strictObject({
  requirementId: z.string(),
  reason: unscoredRequirementReasonSchema,
});
export type UnscoredRequirement = z.infer<typeof unscoredRequirementSchema>;

/**
 * The engine's whole result. Structural laws:
 * - verdict is `excluded` exactly when exclusions is non-empty — the verdict
 *   can never drift from its evidence;
 * - subScores carries EVERY dimension exactly once (all seven, always — an
 *   excluded report keeps its informative breakdown);
 * - no merged overall score exists anywhere (M1-10 law, strongest form).
 * The persisted fit_reports row adds criteria_snapshot (the exact criteria
 * object scored) and review workflow fields around this payload; the engine
 * itself stays snapshot-free — it RECEIVES criteria, it does not copy them.
 */
export const fitReportDataSchema = z
  .strictObject({
    verdict: fitVerdictSchema,
    exclusions: z.array(exclusionVerdictSchema),
    subScores: z.array(subScoreSchema).length(FIT_DIMENSIONS.length),
    unscoredRequirements: z.array(unscoredRequirementSchema),
    forcedLowestPriority: forcedLowestSchema,
    inputFlagged: z.boolean(),
  })
  .superRefine((report, ctx) => {
    const excluded = report.exclusions.length > 0;
    if ((report.verdict === 'excluded') !== excluded) {
      ctx.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'verdict must be excluded exactly when exclusions is non-empty',
      });
    }
    const seen = new Set(report.subScores.map((subScore) => subScore.dimension));
    if (seen.size !== FIT_DIMENSIONS.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['subScores'],
        message: 'subScores must carry every fit dimension exactly once',
      });
    }
  });
export type FitReportData = z.infer<typeof fitReportDataSchema>;
