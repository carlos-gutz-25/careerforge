// Shared constants for the e2e harness (plain JS — runs before any build
// tooling). ALL credentials here are fictional throwaways; the API boots
// against the scratch careerforge_e2e DB, which global teardown drops.
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const E2E_WEB_PORT = 4310;
export const E2E_API_PORT = 4311;
export const E2E_WEB_ORIGIN = `http://localhost:${E2E_WEB_PORT}`;
export const E2E_API_BASE = `http://localhost:${E2E_API_PORT}`;

export const E2E_BOOTSTRAP_EMAIL = 'e2e.throwaway.fictional@example.com';
export const E2E_BOOTSTRAP_PASSWORD = 'fictional-e2e-password-01';

/** careerforge_e2e derived from DATABASE_URL (the _test derivation, e2e'd). */
export function e2eDatabaseUrl() {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is not set — .env.example documents it.');
  }
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_e2e`;
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
