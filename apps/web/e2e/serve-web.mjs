// Serves the web app on the dedicated e2e port with the API base pointed at
// the e2e API. Dev server (see playwright.config.ts for the disclosed
// build+preview deviation); bypasses the dev:web 4300 preflight because the
// e2e port is its own — Playwright's reuseExistingServer: false is the
// loud-fail if 4310 is already taken.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { E2E_API_BASE, E2E_WEB_PORT } from './e2e-env.mjs';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const child = spawn('pnpm', ['exec', 'nuxt', 'dev', '--port', String(E2E_WEB_PORT)], {
  cwd: appDir,
  env: {
    ...process.env,
    NUXT_PUBLIC_API_BASE: E2E_API_BASE,
    NUXT_TELEMETRY_DISABLED: '1',
  },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill('SIGTERM'));
}
