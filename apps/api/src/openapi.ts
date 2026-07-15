import { buildApp } from './app.ts';
import { type Env } from './env.ts';

/**
 * Fixed inert environment for spec generation. The spec derives entirely from
 * the route schemas — no env value can change it — so generation deliberately
 * does NOT read process.env (deterministic output, runs in CI with no
 * secrets). Nothing here is a credential: pg.Pool connects lazily and
 * buildApp never queries, so the DATABASE_URL is never dialed.
 *
 * NODE_ENV is 'development', so the generator app DOES register the /docs UI
 * routes — they stay out of the spec because @fastify/swagger-ui marks every
 * route it registers `schema: { hide: true }` and @fastify/swagger excludes
 * hidden routes (lib/util/should-route-hide.js). Since /docs is the only
 * env-dependent surface, the committed spec is therefore also exactly the
 * production API surface, by construction rather than by generation mode.
 */
export const SPEC_ENV: Env = {
  NODE_ENV: 'development',
  API_PORT: 4301,
  LOG_LEVEL: 'warn',
  DATABASE_URL: 'postgresql://spec:spec@127.0.0.1:5432/spec_never_connects',
  AUTH_BOOTSTRAP_EMAIL: 'spec.generator.inert@example.com',
  AUTH_BOOTSTRAP_PASSWORD: 'inert-spec-generation-password',
  WEB_APP_ORIGIN: 'http://localhost:4300',
};

/**
 * Renders the spec exactly as committed at docs/api/openapi.json — the single
 * serialization path shared by the generator CLI and the drift test, so
 * byte-equality between them is structural, not incidental.
 */
export async function renderOpenApiSpec(): Promise<string> {
  const app = await buildApp(SPEC_ENV);
  try {
    await app.ready();
    return JSON.stringify(app.swagger(), null, 2) + '\n';
  } finally {
    await app.close();
  }
}
