// Resolves the Playwright e2e database URL (M5-03: parallel-dev harness).
//
// Overridable per git worktree so parallel lanes never collide on one scratch
// DB, two ways:
//   - TEST_DB_SUFFIX appends to the derived name (careerforge_e2e ->
//     careerforge_e2e_a1) so a lane sets ONE short value that scopes BOTH its
//     _test and _e2e databases, with credentials still derived from
//     DATABASE_URL (nothing secret to hand-edit). This is the per-lane knob.
//   - E2E_DATABASE_URL replaces the whole URL outright (the escape hatch that
//     mirrors TEST_DATABASE_URL for the integration suite) when a lane points
//     e2e at an entirely different server.
// Both default to today's careerforge_e2e, unchanged.
//
// Pure and env-explicit (the env is a parameter) so the DB-lifecycle CLI
// (cli/e2e-db.ts) resolves the same URL as this module's unit test. The
// Playwright harness (apps/web/e2e/e2e-env.mjs) mirrors this logic by hand
// rather than importing it, because the module wall keeps apps/web from
// reaching into packages/db (apps/web only ever shells out); the two must stay
// in sync, and the live overridden e2e run is what proves the mirror agrees.

export function resolveE2eDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.E2E_DATABASE_URL;
  if (override) return override;
  const base = env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'DATABASE_URL is not set - .env.example documents it (or set E2E_DATABASE_URL).',
    );
  }
  const suffix = env.TEST_DB_SUFFIX ?? '';
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_e2e${suffix}`;
  return url.href;
}
