import type { LlmProvider, LlmUsage } from './provider/types.ts';
import type { PromptVersion } from './registry/types.ts';
import { wrapUntrustedData } from './untrusted.ts';

// The single composition point for LLM calls: registry lookup supplies the
// static prompt, the caller supplies untrusted data (wrapped into the USER
// message behind a fresh boundary token per wire call), and EVERY call —
// success, schema failure, refusal, truncation, or thrown error — produces a
// complete LlmCallRecord delivered to the required sink.

// First five states are the runner's own; 'flagged' (evidence verification,
// M1-06) is applied post-hoc at the persistence layer and never set here.
export type LlmCallStatus = 'ok' | 'schema_failed' | 'refusal' | 'max_tokens' | 'error';

export interface LlmCallRecord {
  promptId: string;
  provider: string;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
  /** Full provider response, verbatim (ADR-0005 §2: audit + replay). Persisted
   *  by the sink, never logged — it can contain posting text. */
  rawResponse: unknown;
  status: LlmCallStatus;
  /** 1-based; 2 only on the schema-failure retry. */
  attempt: number;
  timestamp: string;
}

export type LlmCallSink = (record: LlmCallRecord) => void | Promise<void>;

export interface RunPromptDeps {
  provider: LlmProvider;
  /**
   * REQUIRED, deliberately not defaulted: recording is law (ADR-0005 §2), and
   * packages/llm cannot persist it itself (SQL lives only in packages/db).
   * M1-05 supplies the extraction_runs-backed sink through the service layer;
   * tests supply in-memory sinks.
   */
  recordCall: LlmCallSink;
  /** Clock seam for latency tests; defaults to Date.now. */
  now?: () => number;
}

export type RunPromptResult<TOutput> =
  | { status: 'ok'; output: TOutput; record: LlmCallRecord }
  | { status: 'schema_failed' | 'refusal' | 'max_tokens'; record: LlmCallRecord };

const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

// One retry on schema failure, then schema_failed (ADR-0005 §3). Refusals and
// truncation never retry: a refusal is a content outcome the same input will
// reproduce, and max_tokens truncation is a prompt-config bug (headroom) that
// must surface as itself — conflating it with schema_failed would misdiagnose
// a sizing problem as a model problem.
const MAX_ATTEMPTS = 2;

export async function runPrompt<TOutput>(
  prompt: PromptVersion<TOutput>,
  args: { untrustedData: string },
  deps: RunPromptDeps,
): Promise<RunPromptResult<TOutput>> {
  const now = deps.now ?? Date.now;
  let lastRecord: LlmCallRecord | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Fresh boundary token per attempt: "per-request" means per wire call.
    const userContent = `${prompt.instructions}\n\n${wrapUntrustedData(args.untrustedData)}`;
    const startedAt = now();

    let generated;
    try {
      generated = await deps.provider.generate({
        system: prompt.system,
        messages: [{ role: 'user', content: userContent }],
        maxTokens: prompt.maxTokens,
        jsonSchema: prompt.jsonSchema,
        ...(prompt.thinking !== undefined ? { thinking: prompt.thinking } : {}),
      });
    } catch (error) {
      // Recording is unconditional; the error itself propagates to the
      // caller. Only safe, value-free fields enter the record.
      await deps.recordCall({
        promptId: prompt.id,
        provider: deps.provider.name,
        model: 'unknown',
        usage: ZERO_USAGE,
        latencyMs: now() - startedAt,
        rawResponse: { error: error instanceof Error ? error.name : 'unknown' },
        status: 'error',
        attempt,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }

    const record = (status: LlmCallStatus): LlmCallRecord => ({
      promptId: prompt.id,
      provider: deps.provider.name,
      model: generated.model,
      usage: generated.usage,
      latencyMs: now() - startedAt,
      rawResponse: generated.raw,
      status,
      attempt,
      timestamp: new Date().toISOString(),
    });

    if (generated.stopReason === 'refusal') {
      const rec = record('refusal');
      await deps.recordCall(rec);
      return { status: 'refusal', record: rec };
    }
    if (generated.stopReason === 'max_tokens') {
      const rec = record('max_tokens');
      await deps.recordCall(rec);
      return { status: 'max_tokens', record: rec };
    }

    let output: TOutput | undefined;
    let parsed = false;
    try {
      const json: unknown = JSON.parse(generated.text);
      const result = prompt.outputSchema.safeParse(json);
      if (result.success) {
        output = result.data;
        parsed = true;
      }
    } catch {
      // Not JSON at all — same schema_failed path as a shape mismatch.
    }

    if (parsed) {
      const rec = record('ok');
      await deps.recordCall(rec);
      return { status: 'ok', output: output as TOutput, record: rec };
    }

    lastRecord = record('schema_failed');
    await deps.recordCall(lastRecord);
  }

  // Loop bound guarantees lastRecord is set when we get here.
  return { status: 'schema_failed', record: lastRecord as LlmCallRecord };
}
