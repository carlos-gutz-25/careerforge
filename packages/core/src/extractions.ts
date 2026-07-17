import { z } from 'zod';

import {
  extractionRunStatusSchema,
  requirementCategorySchema,
  requirementKindSchema,
} from './enums.ts';

// Wire contracts for POST /postings/:id/extract and
// GET /postings/:id/requirements (M1-05). Two values NEVER cross the wire:
// `rawText` (its single wire path stays the posting detail GET — the
// openapi-drift tripwire pins it to exactly two spec sites) and
// `raw_response` (audit/replay only; it can embed posting text). Per-run
// usage IS on the wire deliberately: RISKS T-03's mitigation is "token usage
// recorded per run" and ARCHITECTURE §6 promises it visible in the UI —
// cost telemetry is not sensitive (M1-05 external review P1).

export const extractionRunSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  provider: z.string(),
  model: z.string(),
  status: extractionRunStatusSchema,
  attempt: z.number().int().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadInputTokens: z.number().int().min(0),
  cacheCreationInputTokens: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type ExtractionRun = z.infer<typeof extractionRunSchema>;

/** `quoteVerified` is NULL until evidence verification (M1-06) runs;
 *  true/false only after. `sourceQuote` is posting-derived and therefore
 *  UNTRUSTED on display, exactly like rawText (RISKS S-02). */
export const requirementSchema = z.object({
  id: z.string(),
  kind: requirementKindSchema,
  category: requirementCategorySchema,
  text: z.string(),
  sourceQuote: z.string(),
  quoteVerified: z.boolean().nullable(),
  confidence: z.number().min(0).max(1),
});
export type Requirement = z.infer<typeof requirementSchema>;

/** `force: true` is the explicit re-extraction (append-only — a new run every
 *  time). Without it, an existing ok run for this posting × prompt version is
 *  served from the DB with no LLM call (cache by content_hash × prompt_id;
 *  posting content is immutable after ingest, so posting_id stands in for
 *  content_hash within a user). */
export const postingExtractBodySchema = z.object({
  force: z.boolean().default(false),
});
export type PostingExtractBody = z.infer<typeof postingExtractBodySchema>;

/**
 * 201 = a fresh extraction ran and its run row(s) were created — INCLUDING
 * non-ok terminal outcomes (`schema_failed`/`refusal`/`max_tokens`), which
 * are results, not transport errors: the append-only run ledger gained a row,
 * `run.status` is the discriminant, and `requirements` is empty. 200 with
 * `cached: true` = served from a prior ok run, no LLM call.
 */
export const postingExtractResponseSchema = z.object({
  run: extractionRunSchema,
  requirements: z.array(requirementSchema),
  cached: z.boolean(),
});
export type PostingExtractResponse = z.infer<typeof postingExtractResponseSchema>;

/** `run: null` = no successful extraction yet — an empty collection, not a
 *  404 (the posting exists). Otherwise the latest ok run (any prompt
 *  version) and its requirements in model output order. */
export const postingRequirementsResponseSchema = z.object({
  run: extractionRunSchema.nullable(),
  requirements: z.array(requirementSchema),
});
export type PostingRequirementsResponse = z.infer<typeof postingRequirementsResponseSchema>;
