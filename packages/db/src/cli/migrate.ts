// CLI entry for `pnpm db:migrate` (invoked with --env-file-if-exists=.env).
// Plain writes, not pino: this is a terminal tool, not the service log stream.
import {
  isConnectionRefused,
  postgresUnreachableMessage,
  runMigrations,
} from '../migrate.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('DATABASE_URL is not set — .env.example documents it.\n');
  process.exit(1);
}

try {
  await runMigrations(databaseUrl);
  process.stdout.write('migrations up to date\n');
} catch (error) {
  if (isConnectionRefused(error)) {
    process.stderr.write(`${postgresUnreachableMessage(databaseUrl)}\n`);
  } else {
    process.stderr.write(`migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(1);
}
