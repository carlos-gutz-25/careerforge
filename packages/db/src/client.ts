import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.ts';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  /** Owned by the caller: `await pool.end()` on shutdown. */
  pool: pg.Pool;
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // casing must match drizzle.config.ts so runtime SQL and generated
  // migrations agree on column names.
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
