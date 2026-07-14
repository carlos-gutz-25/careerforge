// CLI entry for `pnpm db:seed` — fictional example-profile data only.
// Plain writes, not pino: terminal tool, not the service log stream.
import { createDb } from '../client.ts';
import { isConnectionRefused, postgresUnreachableMessage } from '../migrate.ts';
import { seed } from '../seed.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('DATABASE_URL is not set — .env.example documents it.\n');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const summary = await seed(db);
  process.stdout.write(
    `seeded example profile (fictional): user ${summary.userId} — ${summary.skills} skills, ${summary.experiences} experiences, ${summary.projects} projects, 1 search_criteria\n`,
  );
} catch (error) {
  if (isConnectionRefused(error)) {
    process.stderr.write(`${postgresUnreachableMessage(databaseUrl)}\n`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`seed failed: ${message}\n(is the schema migrated? pnpm db:migrate)\n`);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
