import pg from 'pg';

import { isConnectionRefused, postgresUnreachableMessage, runMigrations } from '../migrate.ts';
import { resolveTestDatabaseUrl } from './db-test-utils.ts';

/**
 * Runs once before the db project's tests: create careerforge_test if it
 * doesn't exist, apply the checked-in migrations. Unreachable Postgres FAILS
 * the run (ratified 2026-07-13) — a green suite must mean everything ran.
 */
export default async function setup(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl();
  try {
    await ensureDatabaseExists(testUrl);
    await runMigrations(testUrl);
  } catch (error) {
    if (isConnectionRefused(error)) {
      throw new Error(postgresUnreachableMessage(testUrl));
    }
    throw error;
  }
}

async function ensureDatabaseExists(testUrl: string): Promise<void> {
  const dbName = new URL(testUrl).pathname.replace(/^\//, '');
  // CREATE DATABASE can't run inside the target DB — use the maintenance DB.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.href });
  await client.connect();
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [dbName]);
    if (existing.rowCount === 0) {
      // Identifiers can't be parameterized; the name comes from trusted env.
      await client.query(`create database "${dbName.replaceAll('"', '""')}"`);
    }
  } finally {
    await client.end();
  }
}
