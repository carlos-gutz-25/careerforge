import { z } from 'zod';

// Single source of truth for the API's environment. Every key here must be
// documented in .env.example (enforced by env.test.ts). Variables consumed
// only by docker compose (POSTGRES_*) are deliberately not listed: the API
// reaches Postgres exclusively through DATABASE_URL.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses an environment (normally process.env) against the schema.
 * Throws a single Error naming every missing/invalid variable, so a
 * misconfigured boot fails fast with an actionable message.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment:\n${problems}\nSet the variable(s) in .env — .env.example documents every one.`,
    );
  }
  return result.data;
}
