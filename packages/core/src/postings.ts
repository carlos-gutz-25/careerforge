import { z } from 'zod';

import { jobPostingStatusSchema } from './enums.ts';

// Wire contracts for POST /postings (M1-01). Posting text is UNTRUSTED from
// the moment it arrives (RISKS S-01/S-02, ADR-0006 layer 5): stored verbatim,
// never rendered as HTML/markdown, never logged, never in an LLM system
// prompt. The ingest RESPONSE deliberately carries no rawText — the client
// just sent it, and not echoing it keeps posting text off every response
// path until M1-02's escaped detail rendering.

/**
 * Cost-bound cap on pasted text (~10× the largest plausible real posting;
 * M1-05 sends this text to a paid model). Counts UTF-16 code units — examined
 * and accepted for a cost bound (dismissed alternative: bytes/graphemes).
 * Enforced in the route schema; Fastify's default 1 MiB bodyLimit is the
 * transport backstop.
 */
export const POSTING_RAW_TEXT_MAX_CHARS = 100_000;

// A Postgres text column rejects U+0000 outright, so a NUL in rawText would
// otherwise reach the DB and 500 (M1-07 O-2, confirmed on-branch). Reject it at
// the boundary instead: the refine fails validation, taking the value-free
// VALIDATION_ERROR path (the error handler emits paths + issue codes only,
// never the received value or this message). Mirrors the model-output NUL
// refine in extract-requirements@v1 (M1-05 external review P2).
const rawTextNoNul = (value: string) => !value.includes('\u0000');

export const postingIngestBodySchema = z.object({
  // regex(/\S/): a whitespace-only paste is no posting at all.
  rawText: z
    .string()
    .min(1)
    .max(POSTING_RAW_TEXT_MAX_CHARS)
    .regex(/\S/)
    .refine(rawTextNoNul, 'must not contain U+0000'),
  // Optional caller-supplied metadata, display-only. Trimmed at the service
  // boundary; values that trim to empty are stored as NULL.
  company: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  sourceNote: z.string().max(1000).optional(),
});
export type PostingIngestBody = z.infer<typeof postingIngestBodySchema>;

export const postingSchema = z.object({
  id: z.string(),
  company: z.string().nullable(),
  title: z.string().nullable(),
  sourceNote: z.string().nullable(),
  status: jobPostingStatusSchema,
  createdAt: z.iso.datetime(),
});
export type Posting = z.infer<typeof postingSchema>;

/**
 * 201 = created; 200 with `duplicate: true` = this user already pasted
 * byte-equivalent (whitespace-normalized) text, and `posting` is the STORED
 * record — metadata sent with the duplicate paste is discarded (first-write
 * wins), which the client can detect by comparing the echo.
 */
export const postingIngestResponseSchema = z.object({
  posting: postingSchema,
  duplicate: z.boolean(),
});
export type PostingIngestResponse = z.infer<typeof postingIngestResponseSchema>;

/** List payload (M1-02): metadata ONLY — rawText's single wire path is the
 *  detail GET; every other response carries the trimmed `postingSchema`. */
export const postingListResponseSchema = z.object({
  postings: z.array(postingSchema),
});
export type PostingListResponse = z.infer<typeof postingListResponseSchema>;

/** Detail payload (M1-02): the ONE response that carries rawText. It is
 *  UNTRUSTED — the client renders it as escaped plain text (interpolation +
 *  CSS pre-wrap), never as HTML/markdown (RISKS S-02, ADR-0006 layer 5). */
export const postingDetailSchema = postingSchema.extend({
  rawText: z.string(),
});
export type PostingDetail = z.infer<typeof postingDetailSchema>;

/**
 * Statuses a USER may set via PATCH (M1-02). `extracted`/`scored` are
 * pipeline-owned facts about artifacts (extraction runs — M1-05; fit
 * reports — M1-09/10) and are unrepresentable in this contract: hand-setting
 * them would assert artifacts that don't exist. `archived` is reachable from
 * any status; `new` (unarchive) only from `archived` — the from-state rule
 * lives in the service.
 */
export const USER_SETTABLE_POSTING_STATUSES = ['new', 'archived'] as const;
export const postingStatusUpdateBodySchema = z.object({
  status: z.enum(USER_SETTABLE_POSTING_STATUSES),
});
export type PostingStatusUpdateBody = z.infer<typeof postingStatusUpdateBodySchema>;
