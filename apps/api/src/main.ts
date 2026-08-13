// API boot entry (run via `pnpm dev`, which loads ../../.env). Env validation
// must be the first thing that happens at boot; everything else builds on the
// validated result. The stderr write is the one log line that may exist
// before the pino logger does.
import {
  assertNoMigrationDrift,
  createDemoSeedStateRepository,
  createUsersRepository,
  MigrationDriftError,
} from '@careerforge/db';

import { buildApp } from './app.ts';
import { parseEnv, type Env } from './env.ts';
import { ensureBootstrapUser } from './modules/auth/bootstrap.ts';
import { passwords } from './modules/auth/passwords.ts';
import { assertDemoSeeded, DemoUnseededError } from './modules/demo/demo-boot.ts';

const env: Env = (() => {
  try {
    return parseEnv(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
})();

const app = await buildApp(env);
// Fail-closed on CONFIRMED migration drift (M15-05, FINDING-B): running dev
// against a database missing a checked-in migration does not fail here, it
// fails later at whatever statement first needs the missing column - twice, at
// the cost of live debugging. Dev-only and never fatal on an indeterminate
// result, so this can refuse a boot but cannot crash one.
try {
  await assertNoMigrationDrift({
    nodeEnv: env.NODE_ENV,
    db: app.db,
    note: (line) => app.log.warn(line),
  });
} catch (error) {
  if (error instanceof MigrationDriftError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
// Boot-time only (never in buildApp): tests create their own fictional users.
await ensureBootstrapUser({
  users: createUsersRepository(app.db),
  passwords,
  env,
  log: app.log,
});
// Fail-closed (M10-03 D7b): a DEMO_MODE instance must be seeded before it
// serves. An unseeded demo exits loudly rather than serving an empty demo.
try {
  await assertDemoSeeded({
    demoMode: env.DEMO_MODE,
    seedState: createDemoSeedStateRepository(app.db),
  });
} catch (error) {
  if (error instanceof DemoUnseededError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
await app.listen({ port: env.API_PORT, host: env.API_HOST });
