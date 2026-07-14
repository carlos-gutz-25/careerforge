// API boot entry (run via `pnpm dev`, which loads ../../.env). Env validation
// must be the first thing that happens at boot; everything else builds on the
// validated result. The stderr write is the one log line that may exist
// before the pino logger does.
import { createUsersRepository } from '@careerforge/db';

import { buildApp } from './app.ts';
import { parseEnv, type Env } from './env.ts';
import { ensureBootstrapUser } from './modules/auth/bootstrap.ts';
import { passwords } from './modules/auth/passwords.ts';

const env: Env = (() => {
  try {
    return parseEnv(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
})();

const app = await buildApp(env);
// Boot-time only (never in buildApp): tests create their own fictional users.
await ensureBootstrapUser({
  users: createUsersRepository(app.db),
  passwords,
  env,
  log: app.log,
});
await app.listen({ port: env.API_PORT, host: '127.0.0.1' });
