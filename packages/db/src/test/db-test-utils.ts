import { fileURLToPath } from 'node:url';

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

import { createDb, type DbHandle } from '../client.ts';
import * as schema from '../schema/index.ts';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

/** Loads the repo-root .env; already-set variables win (CI sets them directly). */
export function loadRootEnv(): void {
  try {
    process.loadEnvFile(ROOT_ENV_FILE);
  } catch {
    // No .env file — fine, the environment itself must provide the variables.
  }
}

/**
 * Tests never touch the dev database: TEST_DATABASE_URL if set, otherwise
 * DATABASE_URL with the database name suffixed `_test` (careerforge →
 * careerforge_test). Kept deterministic so the global setup and every test
 * file independently resolve the same URL.
 */
export function resolveTestDatabaseUrl(): string {
  loadRootEnv();
  const override = process.env.TEST_DATABASE_URL;
  if (override) return override;
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'DATABASE_URL is not set — .env.example documents it (or set TEST_DATABASE_URL).',
    );
  }
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.href;
}

export function createTestDb(): DbHandle {
  return createDb(resolveTestDatabaseUrl());
}

const TABLE_NAMES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table));

/** Between-test isolation: one statement, FK-order-proof via CASCADE. */
export async function truncateAllTables(handle: DbHandle): Promise<void> {
  const list = TABLE_NAMES.map((name) => `"${name}"`).join(', ');
  await handle.pool.query(`truncate table ${list} restart identity cascade`);
}

/** drizzle ≥0.44 wraps driver errors (DrizzleQueryError); walk .cause for the pg code. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  return pgErrorCode((error as { cause?: unknown }).cause);
}
