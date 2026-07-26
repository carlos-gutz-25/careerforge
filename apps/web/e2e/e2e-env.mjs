// Shared constants for the e2e harness (plain JS — runs before any build
// tooling). ALL credentials here are fictional throwaways; the API boots
// against the scratch careerforge_e2e DB, which global teardown drops.
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Ports and the scratch DB are overridable per git worktree (M5-03) so parallel
// lanes never collide; defaults are the historical 4310/4311 and careerforge_e2e.
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT) || 4310;
export const E2E_API_PORT = Number(process.env.E2E_API_PORT) || 4311;
export const E2E_WEB_ORIGIN = `http://localhost:${E2E_WEB_PORT}`;
export const E2E_API_BASE = `http://localhost:${E2E_API_PORT}`;

export const E2E_BOOTSTRAP_EMAIL = 'e2e.throwaway.fictional@example.com';
export const E2E_BOOTSTRAP_PASSWORD = 'fictional-e2e-password-01';

/**
 * The e2e scratch DB URL, overridable per worktree (M5-03): E2E_DATABASE_URL
 * replaces it outright; otherwise careerforge_e2e is derived from DATABASE_URL
 * (the _test derivation, e2e'd) with TEST_DB_SUFFIX appended (the per-lane knob
 * shared with the integration suite). MIRRORS
 * packages/db/src/e2e-db-url.ts::resolveE2eDatabaseUrl — the module wall keeps
 * apps/web from importing packages/db, so keep the two in sync (the CLI
 * creates+migrates this DB; this sets the API's DATABASE_URL, and they must name
 * the same database). The live overridden e2e run proves the mirror agrees.
 */
export function e2eDatabaseUrl() {
  const override = process.env.E2E_DATABASE_URL;
  if (override) return override;
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'DATABASE_URL is not set — .env.example documents it (or set E2E_DATABASE_URL).',
    );
  }
  const suffix = process.env.TEST_DB_SUFFIX ?? '';
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_e2e${suffix}`;
  return url.href;
}

/** The API process env: validated-env keys only, everything explicit. */
export function apiEnv() {
  return {
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'warn',
    API_PORT: String(E2E_API_PORT),
    DATABASE_URL: e2eDatabaseUrl(),
    WEB_APP_ORIGIN: E2E_WEB_ORIGIN,
    AUTH_BOOTSTRAP_EMAIL: E2E_BOOTSTRAP_EMAIL,
    AUTH_BOOTSTRAP_PASSWORD: E2E_BOOTSTRAP_PASSWORD,
  };
}
