import { z } from 'zod';

// Single source of truth for the API's environment. Every key here must be
// documented in .env.example (enforced by env.test.ts). Variables consumed
// only by docker compose (POSTGRES_*) are deliberately not listed: the API
// reaches Postgres exclusively through DATABASE_URL.
export const envSchema = z.object({
  // Fail-closed (M13-03): NO default. app.ts hides 5xx internals only when
  // NODE_ENV is literally 'production', so a boot that silently defaulted to
  // 'development' would leak raw error bodies. Requiring the variable means any
  // non-container start (plain node, PM2, a PaaS that drops the var) aborts at
  // boot through parseEnv naming NODE_ENV, rather than serving in the wrong
  // posture. Every legit launch sets it: .env (NODE_ENV=development, loaded via
  // --env-file), the Docker image (ENV NODE_ENV=production), ECS, and the e2e
  // harness; tests pass it explicitly.
  NODE_ENV: z.enum(['development', 'test', 'production']),
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
  // 4300/4301 pair: Binnie (a permanent local service) owns :3000 and
  // its neighborhood (relocated 2026-07-15; see .env.example).
  WEB_APP_ORIGIN: z.url().default('http://localhost:4300'),
  // LLM provider (M1-05). The key is OPTIONAL — a keyless boot (CI, fresh
  // clone, e2e) still serves everything except live extraction, which
  // returns 503 LLM_NOT_CONFIGURED. Empty string counts as absent:
  // .env.example ships the var blank, and node --env-file surfaces that as
  // ''. Stricter validation (min length) lives in packages/llm's own schema
  // for surfaces that REQUIRE the key (llm:smoke).
  ANTHROPIC_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  LLM_MODEL: z.string().min(1).default('claude-sonnet-5'),
  // Host the API binds to (main.ts listen). Default loopback for local dev;
  // the Docker image sets 0.0.0.0 so the container is reachable (M10-02).
  API_HOST: z.string().min(1).default('127.0.0.1'),
  // Optional path to the built static SPA payload (apps/web `nuxt generate`
  // output). When set, apps/api serves it via @fastify/static for a same-origin
  // deploy (M10-02); unset in dev/test/CI = API-only, zero behavior change.
  // Empty string counts as absent (the ANTHROPIC_API_KEY pattern above).
  WEB_DIST_DIR: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  // Demo posture (M10-03). Both optional, default OFF, `'1'` means on (anything
  // else, including absent/empty, is off). DEMO_MODE turns the public demo
  // container's posture on: the LLM-draft POSTs return DEMO_DISABLED, mutating
  // requests are rate-limited per IP, and boot is fail-closed on the seed marker.
  // TRUST_PROXY tells Fastify to read the client IP from X-Forwarded-For; set it
  // ONLY where a trusted front (ALB/App Runner) exists, else request.ip is
  // spoofable. Local/dev/test leave both off = today's behavior byte-for-byte.
  DEMO_MODE: z.preprocess((value) => value === '1', z.boolean()),
  TRUST_PROXY: z.preprocess((value) => value === '1', z.boolean()),
});

export type Env = z.infer<typeof envSchema>;

// Fail-closed (the headline demo law): a demo instance is keyless by decision.
// If DEMO_MODE is on AND an ANTHROPIC_API_KEY is present, refuse to boot rather
// than serve a keyed demo. Applied as a refinement over the object schema (kept
// bare so `.shape` stays available to the .env.example contract test) - it runs
// inside parseEnv before anything else exists, so a mis-provisioned demo
// container dies at boot with an actionable message.
const checkedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.DEMO_MODE && env.ANTHROPIC_API_KEY !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['DEMO_MODE'],
      message:
        'demo instances are keyless by decision - unset ANTHROPIC_API_KEY or unset DEMO_MODE',
    });
  }
});

/**
 * Parses an environment (normally process.env) against the schema.
 * Throws a single Error naming every missing/invalid variable, so a
 * misconfigured boot fails fast with an actionable message.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = checkedEnvSchema.safeParse(source);
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
