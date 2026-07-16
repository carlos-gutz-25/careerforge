import { z } from 'zod';

// The LLM module's own validated environment (mirrors apps/api/src/env.ts).
// The key hygiene invariants (RUNBOOKS.md): the key is read here and only
// here — never a CLI argument, never logged, never echoed in an error.
// .env.example documents both names; apps/api composes this schema when it
// wires a live provider (M1-05).
export const llmEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  // ADR-0005: claude-sonnet-5 recommended for extraction.
  LLM_MODEL: z.string().min(1).default('claude-sonnet-5'),
});

export type LlmEnv = z.infer<typeof llmEnvSchema>;

/**
 * Parses an environment (normally process.env) against the schema. Throws a
 * single Error naming every missing/invalid variable — names only, values
 * never appear in the message.
 */
export function parseLlmEnv(source: Record<string, string | undefined>): LlmEnv {
  const result = llmEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid LLM environment:\n${problems}\nSet the variable(s) in .env — .env.example documents every one.`,
    );
  }
  return result.data;
}
