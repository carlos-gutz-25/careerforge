import { MODULE_ID as CORE_MODULE_ID } from '@careerforge/core';

export const MODULE_ID = '@careerforge/llm';
export const INTERNAL_DEPENDENCIES = [CORE_MODULE_ID];

// Provider seam (ADR-0005 §1)
export type {
  GenerateRequest,
  GenerateResult,
  LlmMessage,
  LlmProvider,
  LlmStopReason,
  LlmUsage,
  ThinkingMode,
} from './provider/types.ts';
export {
  createAnthropicProvider,
  type AnthropicClientLike,
  type AnthropicProviderConfig,
} from './provider/anthropic.ts';
export { createMockProvider, type MockProvider, type MockResponse } from './provider/mock.ts';

// Versioned prompt registry (ADR-0005 §2)
export { definePrompt, type PromptVersion, type PromptVersionInput } from './registry/types.ts';
export { getPrompt, promptRegistry } from './registry/index.ts';
// Product prompts: exported as typed objects so callers get TOutput inference
// (getPrompt returns PromptVersion<unknown> — fine for tooling, not services).
export {
  extractRequirementsV1,
  type ExtractRequirementsOutput,
} from './registry/prompts/extract-requirements/v1.ts';

// Call runner + recording seam
export {
  runPrompt,
  type LlmCallRecord,
  type LlmCallSink,
  type LlmCallStatus,
  type RunPromptDeps,
  type RunPromptResult,
} from './run.ts';
export { wrapUntrustedData } from './untrusted.ts';

// Validated environment (key hygiene: RUNBOOKS.md)
export { llmEnvSchema, parseLlmEnv, type LlmEnv } from './env.ts';
