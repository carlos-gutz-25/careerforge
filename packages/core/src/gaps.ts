import { z } from 'zod';

import {
  gapCarriedViaSchema,
  gapClassificationSchema,
  requirementCategorySchema,
  requirementKindSchema,
} from './enums.ts';

// Wire contracts for GET /fit-reports/:id/gaps and PATCH /gaps/:id (M1-11).
// Gap rows are per-report, append-only artifacts (D1): every scoring run
// writes a fresh gap set in the same transaction as its fit report; an
// override rides forward from the posting's immediately prior report only
// (A1). Everything here is rule-generated from verified inputs; nothing is
// LLM-derived. The requirement display fields are posting-derived and
// therefore UNTRUSTED on display, exactly like rawText (RISKS S-02).

/**
 * One gap row on the wire, with its requirement's display fields joined per
 * row (one fetch renders the section). `classification` is the EFFECTIVE
 * value (engine or override); `engineClassification` is the engine's fresh
 * assignment, immutable — the two diverging is the "engine now disagrees
 * with your override" signal, structured rather than prose-parsed.
 * `carriedVia` is the carry audit (D5): how an override arrived, NULL for a
 * fresh assignment or a direct PATCH.
 */
export const gapResponseSchema = z.strictObject({
  id: z.string(),
  fitReportId: z.string(),
  requirementId: z.string(),
  classification: gapClassificationSchema,
  engineClassification: gapClassificationSchema,
  rationale: z.string().min(1),
  userOverridden: z.boolean(),
  overrideNote: z.string().nullable(),
  carriedVia: gapCarriedViaSchema.nullable(),
  createdAt: z.iso.datetime(),
  requirementText: z.string(),
  requirementKind: requirementKindSchema,
  requirementCategory: requirementCategorySchema,
});
export type GapResponse = z.infer<typeof gapResponseSchema>;

/**
 * GET /fit-reports/:id/gaps. `lostOverrides` counts the immediately prior
 * report's overridden rows that bound to NO row of the rendered report
 * (neither by requirement_id nor by the one-to-one normalized-text match) —
 * derived at read time with exactly the write path's carry rules (A1: read
 * is the complement of write), so a re-extraction never silently drops an
 * override. Pre-0006 reports serve `{ gaps: [], lostOverrides: 0 }` —
 * empty-by-design, no backfill (R3).
 */
export const fitReportGapsResponseSchema = z.strictObject({
  gaps: z.array(gapResponseSchema),
  lostOverrides: z.number().int().min(0),
});
export type FitReportGapsResponse = z.infer<typeof fitReportGapsResponseSchema>;

/** Cost-free sanity bound on override notes (the fit review notes
 *  precedent: a text column, escaped on render, ~10x a long real note). */
export const GAP_OVERRIDE_NOTE_MAX_CHARS = 10_000;

// A Postgres text column rejects U+0000 outright — reject at the boundary
// for a value-free 400 instead of a 500 (the fit review notes precedent).
const noteNoNul = (value: string) => !value.includes('\u0000');

/**
 * PATCH /gaps/:id — the override action. FULL REPLACEMENT, pinned (A2):
 * every PATCH sets the stored override note to trimmed-or-null of `note`;
 * `note` absent or null means the stored note is CLEARED — there are no
 * merge-patch semantics. `classification` is required: a bucket value
 * overrides (recorded as `userOverridden`), and `classification: null` is
 * the un-override (D6) — the row reverts to `engineClassification`,
 * `userOverridden` false, note cleared. Overrides are re-editable by design
 * (unlike the one-shot review), so this is a plain replacement, not a CAS
 * transition (D7).
 */
export const gapOverrideBodySchema = z.strictObject({
  classification: gapClassificationSchema.nullable(),
  note: z
    .string()
    .max(GAP_OVERRIDE_NOTE_MAX_CHARS)
    .refine(noteNoNul, 'must not contain U+0000')
    .nullish(),
});
export type GapOverrideBody = z.infer<typeof gapOverrideBodySchema>;

/** PATCH response is the full updated row — the ONE row contract shared
 *  with the GET, so the UI re-renders in place from either surface. */
export const gapOverrideResponseSchema = gapResponseSchema;
export type GapOverrideResponse = z.infer<typeof gapOverrideResponseSchema>;
