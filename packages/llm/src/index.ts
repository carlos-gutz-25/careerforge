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
export {
  improvementPlanV1,
  type ImprovementPlanOutput,
} from './registry/prompts/improvement-plan/v1.ts';

// Drafting payload builder + citation map (M1-12 §3): the ONE serialization
// site for what a drafting call may see; pure, no DB.
export {
  buildDraftingPayload,
  EVIDENCE_PER_GAP_CAP,
  mapCitedRefs,
  type CitationMapping,
  type DraftingEvidenceInput,
  type DraftingGapInput,
  type DraftingPayload,
  type DraftingSkillInput,
} from './drafting/payload.ts';

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

// Adversarial corpus (ADR-0006 layer 6, M1-07)
export {
  ADVERSARIAL_CORPUS,
  ATTACK_CLASSES,
  type AdversarialFixture,
  type AttackClass,
  type AcceptableStatus,
  type LiveExpectation,
} from './adversarial/index.ts';
export { evaluateFixtureRun, type FixtureVerdict } from './adversarial/evaluate.ts';

// Drafting adversarial corpus (ADR-0006 layer 6 at the drafting ingress, M1-12)
export {
  DRAFTING_ADVERSARIAL_CORPUS,
  DRAFTING_ATTACK_CLASSES,
  type DraftingAdversarialFixture,
} from './adversarial/drafting/index.ts';
export {
  evaluateDraftingFixtureRun,
  type DraftingFixtureVerdict,
} from './adversarial/drafting/evaluate.ts';
