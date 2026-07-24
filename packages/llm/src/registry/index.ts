import { extractRequirementsV1 } from './prompts/extract-requirements/v1.ts';
import { fixtureEchoV1 } from './prompts/fixture-echo/v1.ts';
import { improvementPlanV1 } from './prompts/improvement-plan/v1.ts';
import { learningPlanV1 } from './prompts/learning-plan/v1.ts';
import { resumeTailoringV1 } from './prompts/resume-tailoring/v1.ts';
import { resumeTailoringV2 } from './prompts/resume-tailoring/v2.ts';
import type { PromptVersion } from './types.ts';

// Every shipped prompt version registers here (and pins itself in pins.ts).
// v1 stays registered (historical, pinned) even though the service now calls
// v2 — the versioning law is additive, never in-place.
const ALL_PROMPTS: readonly PromptVersion[] = [
  fixtureEchoV1,
  extractRequirementsV1,
  improvementPlanV1,
  learningPlanV1,
  resumeTailoringV1,
  resumeTailoringV2,
];

function buildRegistry(prompts: readonly PromptVersion[]): ReadonlyMap<string, PromptVersion> {
  const registry = new Map<string, PromptVersion>();
  for (const prompt of prompts) {
    if (registry.has(prompt.id)) {
      throw new Error(`duplicate prompt id: ${prompt.id}`);
    }
    registry.set(prompt.id, prompt);
  }
  return registry;
}

export const promptRegistry: ReadonlyMap<string, PromptVersion> = buildRegistry(ALL_PROMPTS);

export function getPrompt(id: string): PromptVersion {
  const prompt = promptRegistry.get(id);
  if (prompt === undefined) {
    throw new Error(`unknown prompt id: ${id}`);
  }
  return prompt;
}
