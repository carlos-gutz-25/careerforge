// Boots the real API entrypoint (apps/api/src/main.ts — its env bootstrap
// creates the loginable fictional user at first boot) against the scratch
// careerforge_e2e DB on the dedicated e2e port. Launched by Playwright's
// webServer; SIGTERM from Playwright tears it down.
//
// The DB is recreated + migrated HERE, not in a globalSetup: Playwright
// starts webServers BEFORE globalSetup runs (observed on the first run —
// the API died 3D000 on the missing database), so the server process is the
// only place that provably runs before the API needs the DB. `create` drops
// first, so a crashed previous run can't leak state into this one. The
// paired drop lives in global-teardown.mjs (which DOES run last).
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';

import { apiEnv, REPO_ROOT } from './e2e-env.mjs';

execFileSync(
  process.execPath,
  [path.join(REPO_ROOT, 'packages/db/src/cli/e2e-db.ts'), 'create'],
  // apiEnv() carries the plain DATABASE_URL through; the CLI derives _e2e
  // itself. The caller (playwright.config.ts) already loaded .env.
  { stdio: 'inherit', env: process.env },
);

const child = spawn(process.execPath, [path.join(REPO_ROOT, 'apps/api/src/main.ts')], {
  env: apiEnv(),
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill('SIGTERM'));
}
