import type { ZodType } from 'zod';

import type { ThinkingMode } from '../provider/types.ts';

// A prompt version is DATA, not code: every field is a static value fixed at
// module load. There is deliberately no builder function anywhere in this
// shape — nothing here can turn runtime input into prompt text, which is what
// makes ADR-0006 layer 1 ("posting text never in a system prompt") a
// structural property instead of a convention. Untrusted data enters a call
// only through runPrompt, which wraps it into the USER message.
export interface PromptVersionInput<TOutput> {
  /** kebab-case family name, e.g. 'extract-requirements'. */
  name: string;
  /** Integer >= 1. New behavior = new version = new file + new pin. */
  version: number;
  /** Static system prompt — a string constant in the version module. */
  system: string;
  /** Static user-message preamble, prepended before the delimited data. */
  instructions: string;
  /** Zod schema the response text must parse into. Length caps live HERE
   *  (ADR-0006 layer 3) — the wire jsonSchema cannot express them. */
  outputSchema: ZodType<TOutput>;
  /** Wire-level JSON Schema for structured outputs (the zod schema's twin,
   *  minus constraints the API subset doesn't support). */
  jsonSchema: Record<string, unknown>;
  /** Hard cap on thinking + response combined. Size for worst-case output
   *  under the current tokenizer — truncation shows up as stop_reason
   *  max_tokens and is a config bug here, not a model failure. */
  maxTokens: number;
  thinking?: ThinkingMode;
}

export interface PromptVersion<TOutput = unknown> extends Readonly<PromptVersionInput<TOutput>> {
  /** Stable versioned id, e.g. 'extract-requirements@v2'. */
  readonly id: string;
}

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Object.freeze is shallow; a nested jsonSchema node left mutable would let
// in-process code alter wire behavior after the hash pin was checked
// (external review F2, resolved at M1-05). Prompt schemas are plain
// JSON-shaped data — objects, arrays, primitives — so a recursive walk is
// total.
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function definePrompt<TOutput>(input: PromptVersionInput<TOutput>): PromptVersion<TOutput> {
  if (!NAME_PATTERN.test(input.name)) {
    throw new Error(`prompt name must be kebab-case: '${input.name}'`);
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error(`prompt version must be an integer >= 1: ${String(input.version)}`);
  }
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1) {
    throw new Error(`prompt maxTokens must be a positive integer: ${String(input.maxTokens)}`);
  }
  const prompt: PromptVersion<TOutput> = {
    ...input,
    id: `${input.name}@v${String(input.version)}`,
  };
  deepFreeze(prompt.jsonSchema);
  return Object.freeze(prompt);
}
