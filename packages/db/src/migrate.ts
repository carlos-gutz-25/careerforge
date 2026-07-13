import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Resolved relative to this file so it works from any cwd (CLI, tests, CI).
const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '..', 'migrations');

/** Applies all checked-in SQL migrations (forward-only, ADR-0003). Idempotent. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

/** pg reports localhost connect failures as an AggregateError (v4+v6). */
export function isConnectionRefused(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.some(isConnectionRefused);
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ECONNREFUSED'
  );
}

export function postgresUnreachableMessage(databaseUrl: string): string {
  const redacted = new URL(databaseUrl);
  redacted.password = redacted.password ? '***' : '';
  return `Postgres unreachable at ${redacted.href} — run: colima start && docker compose up -d`;
}
