// CLI entry for `pnpm auth:sync-bootstrap` — applies a rotated
// AUTH_BOOTSTRAP_PASSWORD to the existing bootstrap user (re-hash in place +
// revoke all sessions in one transaction). The password is read from the
// validated env ONLY: never a CLI argument, and no output path — success,
// no-op, or error — ever carries the value; messages name variables and
// report counts/status. Plain writes, not pino: terminal tool, not the
// service log stream.
import {
  createDb,
  createUsersRepository,
  isConnectionRefused,
  postgresUnreachableMessage,
} from '@careerforge/db';

import { parseEnv, type Env } from '../env.ts';
import { passwords } from '../modules/auth/passwords.ts';
import { syncBootstrapPassword } from '../modules/auth/sync-bootstrap.ts';

// parseEnv failures list variable names and zod constraint messages, never
// values (its min-length check also catches a shell-mangled password).
let env: Env;
try {
  env = parseEnv(process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const { db, pool } = createDb(env.DATABASE_URL);
try {
  const result = await syncBootstrapPassword({
    users: createUsersRepository(db),
    passwords,
    env,
  });
  switch (result.status) {
    case 'user-missing':
      process.stderr.write(
        'bootstrap user not found — start the API once (`pnpm dev`) to create it.\n',
      );
      process.exitCode = 1;
      break;
    case 'already-synced':
      process.stdout.write(
        'password hash already matches AUTH_BOOTSTRAP_PASSWORD — nothing to do\n',
      );
      break;
    case 'rotated':
      process.stdout.write(
        `password hash updated for user ${result.userId}; ${result.sessionsRevoked} session(s) revoked\n`,
      );
      break;
  }
} catch (error) {
  if (isConnectionRefused(error)) {
    process.stderr.write(`${postgresUnreachableMessage(env.DATABASE_URL)}\n`);
  } else {
    process.stderr.write(
      `bootstrap password sync failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
