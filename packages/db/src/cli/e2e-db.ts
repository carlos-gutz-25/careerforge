// CLI entry for the Playwright e2e database lifecycle (M1-02). SQL lives in
// packages/db (module boundary) — apps/web's e2e setup shells out to this.
//
//   node packages/db/src/cli/e2e-db.ts create   drop + recreate + migrate
//   node packages/db/src/cli/e2e-db.ts drop     drop (global teardown)
//
// The database is DATABASE_URL's name suffixed `_e2e` (careerforge →
// careerforge_e2e), mirroring the `_test` derivation. `create` drops first so
// every run starts clean-slate even after a crashed previous run; `drop` in
// teardown keeps repeated local/CI runs disposable. Callers load .env
// themselves (--env-file-if-exists) — this CLI reads process.env only, so the
// empty-env smoke guard stays deterministic. Never prints URLs/credentials.
import pg from 'pg';

import { isConnectionRefused, postgresUnreachableMessage, runMigrations } from '../migrate.ts';

// Env check first: the direct-node smoke guard runs every CLI arg-less under
// an empty env and expects the missing-variable message.
const base = process.env.DATABASE_URL;
if (!base) {
  process.stderr.write('DATABASE_URL is not set — .env.example documents it.\n');
  process.exit(1);
}

const command = process.argv[2];
if (command !== 'create' && command !== 'drop') {
  process.stderr.write('usage: e2e-db.ts <create|drop>\n');
  process.exit(1);
}

const e2eUrl = new URL(base);
e2eUrl.pathname = `${e2eUrl.pathname.replace(/\/$/, '')}_e2e`;
const dbName = e2eUrl.pathname.replace(/^\//, '');
// Identifiers can't be parameterized; the name derives from trusted env
// (global-setup.ts precedent).
const quoted = `"${dbName.replaceAll('"', '""')}"`;

// CREATE/DROP DATABASE can't run inside the target DB — use the maintenance DB.
const adminUrl = new URL(e2eUrl.href);
adminUrl.pathname = '/postgres';

try {
  const client = new pg.Client({ connectionString: adminUrl.href });
  await client.connect();
  try {
    // FORCE (PG13+) severs lingering connections so teardown never flakes on
    // "database is being accessed by other users".
    await client.query(`drop database if exists ${quoted} with (force)`);
    if (command === 'create') await client.query(`create database ${quoted}`);
  } finally {
    await client.end();
  }
  if (command === 'create') {
    await runMigrations(e2eUrl.href);
    process.stdout.write(`e2e database ${dbName} created and migrated\n`);
  } else {
    process.stdout.write(`e2e database ${dbName} dropped\n`);
  }
} catch (error) {
  if (isConnectionRefused(error)) {
    process.stderr.write(`${postgresUnreachableMessage(e2eUrl.href)}\n`);
  } else {
    process.stderr.write(
      `e2e-db ${command} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  process.exit(1);
}
