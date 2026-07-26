import { defineConfig, devices } from '@playwright/test';

import { E2E_API_BASE, E2E_WEB_ORIGIN } from './e2e/e2e-env.mjs';

// Playwright e2e (M1-02 — the M0-10 park resolved: the XSS AC needs a real
// browser and the flow spans pages). Dedicated e2e ports (4310 web / 4311
// api by default) so runs never collide with the 4300/4301 dev stack; the API
// runs against a scratch careerforge_e2e DB created in global setup and DROPPED
// in global teardown (clean slate every run, locally and in CI). Ports and the
// scratch DB are overridable per worktree (E2E_WEB_PORT/E2E_API_PORT/
// E2E_DATABASE_URL) so parallel lanes can run e2e concurrently (M5-03) — the
// origins below come from e2e-env.mjs so config and servers stay in lockstep.
//
// Retries are CI-ONLY (with trace capture on the retry): one flaky spec in
// the required `test` check blocks every merge, so CI absorbs one-off flakes
// while local runs stay retry-free — flake must be LOUD in dev, or it stops
// being investigated. Ledger records the split trigger: >~5 specs or >3 min
// added to the job graduates e2e to its own job/check.
export default defineConfig({
  testDir: './e2e',
  // DB creation lives in serve-api.mjs (webServers start BEFORE a
  // globalSetup would run); the drop belongs here — teardown runs last.
  globalTeardown: './e2e/global-teardown.mjs',
  retries: process.env.CI ? 2 : 0,
  // The suite mutates one shared scratch DB — keep it serial.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: E2E_WEB_ORIGIN,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // API against careerforge_e2e with fictional throwaway bootstrap creds
      // (main.ts's env bootstrap creates the loginable user at first boot).
      command: 'node --env-file-if-exists=../../.env e2e/serve-api.mjs',
      url: `${E2E_API_BASE}/health`,
      reuseExistingServer: false, // loud-fail if the api port is squatted (M1-01 preflight philosophy)
      timeout: 60_000,
    },
    {
      // Dev server, not build+preview (disclosed deviation from the plan's
      // preference): `nuxt dev` applies NUXT_PUBLIC_* runtime overrides
      // deterministically, while env injection into a prebuilt ssr:false
      // payload is unverified — parked on M4-03 (the first real apps/web
      // build owns that question; see BACKLOG).
      command: 'node --env-file-if-exists=../../.env e2e/serve-web.mjs',
      url: E2E_WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
