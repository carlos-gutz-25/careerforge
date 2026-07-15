import { z } from 'zod';

// Single source of truth for the API's environment. Every key here must be
// documented in .env.example (enforced by env.test.ts). Variables consumed
// only by docker compose (POSTGRES_*) are deliberately not listed: the API
// reaches Postgres exclusively through DATABASE_URL.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4301),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // The single user (ADR-0007): created at first boot iff no user has this
  // email. Deliberately required with no defaults — a missing credential is a
  // misconfiguration, not something to paper over. Changing the password here
  // later does NOT update an already-created user.
  AUTH_BOOTSTRAP_EMAIL: z.email(),
  AUTH_BOOTSTRAP_PASSWORD: z.string().min(12),
  // Browser origin allowed to send mutating requests (CSRF origin check,
  // M0-07); also the future CORS origin for apps/web (M0-10).
  // 4300/4301 pair: binventory (a permanent local service) owns :3000 and
  // its neighborhood (relocated 2026-07-15; see .env.example).
  WEB_APP_ORIGIN: z.url().default('http://localhost:4300'),
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
