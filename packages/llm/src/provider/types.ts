// The thin provider seam (ADR-0005 §1): one call shape, JSON out, swappable
// adapters. Everything the platform knows about an LLM call passes through
// these types — no provider SDK type leaks out of packages/llm.

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Successor to temperature as the determinism/cost lever on current models:
// adaptive thinking is on by default, billed even when its text is omitted,
// and shares the max_tokens budget with the response.
// 'default' (or omitted) sends no thinking field — the model's default applies.
export type ThinkingMode = 'default' | 'disabled';

export interface GenerateRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** JSON Schema for structured outputs (wire-level constraint). String-length
   *  caps are NOT expressible here — they live in the zod layer (ADR-0006 §3). */
  jsonSchema?: Record<string, unknown>;
  thinking?: ThinkingMode;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

// 'refusal': safety classifiers declined (a content outcome, not an error).
// 'max_tokens': output truncated — a config bug (headroom), never to be
// conflated with a schema failure.
export type LlmStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'other';

export interface GenerateResult {
  /** Concatenated text blocks; '' on a pre-output refusal. */
  text: string;
  usage: LlmUsage;
  /** The model that actually served the response. */
  model: string;
  stopReason: LlmStopReason;
  /** Full provider response, verbatim, for audit recording (never logged). */
  raw: unknown;
}

export interface LlmProvider {
  /** Recorded per call: 'anthropic' | 'mock'. */
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
