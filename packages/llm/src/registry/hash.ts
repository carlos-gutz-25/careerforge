import { createHash } from 'node:crypto';

import type { PromptVersion } from './types.ts';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

// Hash of a version's behavior-bearing fields. The zod outputSchema is
// runtime code and can't be hashed; its wire twin jsonSchema is, and the two
// are kept in step by the prompt's own tests.
export function promptContentHash(prompt: PromptVersion): string {
  const material = JSON.stringify({
    name: prompt.name,
    version: prompt.version,
    system: prompt.system,
    instructions: prompt.instructions,
    jsonSchema: sortKeysDeep(prompt.jsonSchema),
    maxTokens: prompt.maxTokens,
    thinking: prompt.thinking ?? 'default',
  });
  return createHash('sha256').update(material).digest('hex');
}
