import {
  type ExtractionRun,
  type PostingExtractResponse,
  type PostingRequirementsResponse,
  type Requirement,
} from '@careerforge/core';
import {
  type ExtractionRunInsert,
  type ExtractionRunRow,
  type ExtractionsRepository,
  type PostingsRepository,
  type RequirementInsert,
  type RequirementRow,
} from '@careerforge/db';
import {
  extractRequirementsV1,
  runPrompt,
  type LlmCallRecord,
  type LlmProvider,
} from '@careerforge/llm';

import { PostingNotFoundError } from '../postings/postings.service.ts';

export class PostingArchivedError extends Error {
  readonly statusCode = 409;
  readonly code = 'POSTING_ARCHIVED';
  constructor() {
    super('posting is archived — unarchive it before extracting');
  }
}

export class LlmNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'LLM_NOT_CONFIGURED';
  constructor() {
    super('no LLM provider configured — set ANTHROPIC_API_KEY');
  }
}

export class LlmUpstreamError extends Error {
  readonly statusCode = 502;
  readonly code = 'LLM_UPSTREAM_ERROR';
  // Value-free by construction: the message carries the upstream error's
  // NAME only (never its message — provider errors can echo request
  // content), plus audit-outcome metadata.
  constructor(errorName: string, auditNote: string) {
    super(`LLM provider call failed: ${errorName}${auditNote}`);
  }
}

export interface ExtractResult {
  response: PostingExtractResponse;
  /** false = served from the run cache (HTTP 200); true = fresh run(s)
   *  persisted (HTTP 201 — including non-ok terminal outcomes). */
  created: boolean;
}

export interface ExtractionService {
  extract(userId: string, postingId: string, force: boolean): Promise<ExtractResult>;
  getRequirements(userId: string, postingId: string): Promise<PostingRequirementsResponse>;
}

/** The packages/core wire shape: usage on the wire per RISKS T-03 (M1-05
 *  external review P1a); rawResponse and userId never leave the row. */
function toWireRun(row: ExtractionRunRow): ExtractionRun {
  return {
    id: row.id,
    promptId: row.promptId,
    provider: row.provider,
    model: row.model,
    status: row.status,
    attempt: row.attempt,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
  };
}

function toWireRequirement(row: RequirementRow): Requirement {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    text: row.text,
    sourceQuote: row.sourceQuote,
    quoteVerified: row.quoteVerified,
    confidence: row.confidence,
  };
}

/** JSON round-trip: normalizes the provider response to plain JSON data
 *  (drops functions/undefined, exactly what jsonb will hold). A real NUL
 *  round-trips as a real NUL; literal backslash-u-0000 TEXT round-trips as
 *  that text. Exported for the R1 behavior pins. */
export function toPlainJson(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? null : (JSON.parse(serialized) as unknown);
}

// The real U+0000 character (not the escape text) — constructed, so no
// literal NUL byte sits in this source file.
const NUL_CHAR = String.fromCharCode(0);

/**
 * Postgres jsonb rejects real U+0000 CHARACTERS anywhere — string values and
 * object keys alike — and losing a whole audit row to one is worse than
 * storing the response verbatim-modulo-NUL (M1-05 ledger). Strips the
 * CHARACTER on the parsed structure, never by text-replacing serialized
 * JSON: the serialized form cannot distinguish a real NUL from the literal
 * 6-char text backslash-u-0000, which must survive byte-identical (external
 * review R1 — the pre-fix text replacement corrupted that text and 500'd a
 * successful extraction). Exported for the R1 behavior pins.
 */
export function stripNulChars(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll(NUL_CHAR, '');
  if (Array.isArray(value)) return value.map(stripNulChars);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key.replaceAll(NUL_CHAR, ''),
        stripNulChars(entry),
      ]),
    );
  }
  return value;
}

/** LlmCallRecord → repository insert: flatten usage, timestamp → createdAt
 *  (the runner's now-seam clock, F3). */
function toInsert(record: LlmCallRecord): ExtractionRunInsert {
  return {
    promptId: record.promptId,
    provider: record.provider,
    model: record.model,
    rawResponse: stripNulChars(toPlainJson(record.rawResponse)),
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheReadInputTokens: record.usage.cacheReadInputTokens,
    cacheCreationInputTokens: record.usage.cacheCreationInputTokens,
    latencyMs: record.latencyMs,
    attempt: record.attempt,
    status: record.status,
    createdAt: new Date(record.timestamp),
  };
}

export function createExtractionService(deps: {
  postings: PostingsRepository;
  extractions: ExtractionsRepository;
  /** undefined = no key in env; extraction is 503 until one is configured. */
  provider: LlmProvider | undefined;
  now?: () => number;
}): ExtractionService {
  const { postings, extractions, provider } = deps;
  const prompt = extractRequirementsV1;

  return {
    async extract(userId, postingId, force) {
      const posting = await postings.findForUser(userId, postingId);
      // Missing and foreign-owned are the same 404 (user-scoped read).
      if (!posting) throw new PostingNotFoundError();
      if (posting.status === 'archived') throw new PostingArchivedError();

      // Cache by content_hash × prompt_id (ADR-0005 §4): posting content is
      // immutable after ingest and deduped on (user_id, content_hash), so
      // posting_id stands in for content_hash within a user. `force` is the
      // explicit, append-only re-extraction.
      if (!force) {
        const cached = await extractions.findLatestOkRun(userId, postingId, prompt.id);
        if (cached) {
          return {
            response: {
              run: toWireRun(cached.run),
              requirements: cached.requirements.map(toWireRequirement),
              cached: true,
            },
            created: false,
          };
        }
      }

      if (!provider) throw new LlmNotConfiguredError();

      // The collecting sink (M1-05 decision F4): an array push cannot throw,
      // so the LlmCallSink must-not-throw contract holds structurally; every
      // collected record reaches extraction_runs in ONE transaction below.
      const records: LlmCallRecord[] = [];
      let result;
      try {
        result = await runPrompt(
          prompt,
          { untrustedData: posting.rawText },
          {
            provider,
            recordCall: (record) => {
              records.push(record);
            },
            ...(deps.now ? { now: deps.now } : {}),
          },
        );
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'unknown';
        // Recording is law on the error path too: persist the value-free
        // error record(s) in their own transaction, then surface the 502.
        let auditNote = '';
        try {
          await extractions.persistExtraction(userId, postingId, records.map(toInsert), undefined);
        } catch {
          // Doubly-failed path (provider AND persistence down): recording is
          // best-effort here — the note below reaches the error log through
          // the app error handler, value-free (P5).
          auditNote = ` (audit record persistence also failed; ${String(records.length)} record(s) lost)`;
        }
        throw new LlmUpstreamError(errorName, auditNote);
      }

      const requirementInserts: RequirementInsert[] | undefined =
        result.status === 'ok'
          ? result.output.requirements.map((requirement) => ({
              kind: requirement.kind,
              category: requirement.category,
              text: requirement.text,
              sourceQuote: requirement.sourceQuote,
              confidence: requirement.confidence,
            }))
          : undefined;

      const outcome = await extractions.persistExtraction(
        userId,
        postingId,
        records.map(toInsert),
        requirementInserts,
      );
      const finalRun = outcome.runs[outcome.runs.length - 1];
      // persistExtraction throws on empty input; the final run always exists.
      if (!finalRun) throw new Error('extraction persisted no runs');

      return {
        response: {
          run: toWireRun(finalRun),
          requirements: outcome.requirements.map(toWireRequirement),
          cached: false,
        },
        created: true,
      };
    },

    async getRequirements(userId, postingId) {
      const posting = await postings.findForUser(userId, postingId);
      if (!posting) throw new PostingNotFoundError();
      // Latest ok run of ANY prompt version; none yet = an empty collection
      // (200 with run: null), not a 404 — the posting exists.
      const latest = await extractions.findLatestOkRun(userId, postingId);
      if (!latest) return { run: null, requirements: [] };
      return {
        run: toWireRun(latest.run),
        requirements: latest.requirements.map(toWireRequirement),
      };
    },
  };
}
