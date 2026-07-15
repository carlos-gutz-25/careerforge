// Playwright global teardown: drop careerforge_e2e so repeated runs are
// clean-slate locally and in CI (ratified at plan approval). Runs after the
// webServers are stopped; the CLI's DROP … WITH (FORCE) severs any straggler
// connection anyway.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { REPO_ROOT } from './e2e-env.mjs';

export default function globalTeardown() {
  execFileSync(
    process.execPath,
    [
      '--env-file-if-exists',
      path.join(REPO_ROOT, '.env'),
      path.join(REPO_ROOT, 'packages/db/src/cli/e2e-db.ts'),
      'drop',
    ],
    { stdio: 'inherit' },
  );
}
