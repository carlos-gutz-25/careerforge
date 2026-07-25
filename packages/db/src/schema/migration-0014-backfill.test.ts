import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from '../test/db-test-utils.ts';

// M3-05: proves the HAND-EDITED part of migration 0014 — the repo's first —
// does what its ordering claims: legacy `complete` exercises (created before
// completed_on existed) are BACKFILLED from updated_at::date BEFORE the
// pairing CHECK is added, so the constraint lands on already-valid data. This
// cannot be tested on the regular test DB (its migrations run on an empty
// schema at global-setup), so a scratch DB replays the journal up to 0013,
// plants pre-0014 rows, then applies 0014 alone. Scratch DB is dropped in
// afterAll. All fixture values fictional (RISKS P-01).

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'migrations');
const SCRATCH_DB = 'careerforge_migration0014_test';

const scratchUrl = (() => {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = `/${SCRATCH_DB}`;
  return url.href;
})();

const adminUrl = (() => {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = '/postgres';
  return url.href;
})();

async function applyMigrationFile(pool: pg.Pool, file: string): Promise<void> {
  const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim().length > 0) await pool.query(statement);
  }
}

let pool: pg.Pool;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${SCRATCH_DB}"`);
    await admin.query(`create database "${SCRATCH_DB}"`);
  } finally {
    await admin.end();
  }
  pool = new pg.Pool({ connectionString: scratchUrl, max: 1 });
});

afterAll(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${SCRATCH_DB}"`);
  } finally {
    await admin.end();
  }
});

describe('migration 0014 backfill ordering (scratch DB replay)', () => {
  it('backfills legacy complete exercises from updated_at::date BEFORE adding the CHECK', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const target = files.find((f) => f.startsWith('0014_'));
    expect(target, 'migration 0014 must exist').toBeDefined();
    const before = files.filter((f) => f < (target as string));

    for (const file of before) await applyMigrationFile(pool, file);

    // Pre-0014 world: complete WITHOUT a date is legal (no column yet).
    const user = await pool.query<{ id: string }>(
      `insert into users (email, password_hash) values ('replay.fictional@example.com', 'fake-hash') returning id`,
    );
    const userId = user.rows[0]!.id;
    const run = await pool.query<{ id: string }>(
      `insert into learning_plan_runs
         (user_id, provider, model, prompt_id, raw_response,
          input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
          latency_ms, attempt, status)
       values ($1, 'anthropic', 'claude', 'learning-plan@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok')
       returning id`,
      [userId],
    );
    const plan = await pool.query<{ id: string }>(
      `insert into learning_plans (user_id, title, drafting_run_id) values ($1, 'Fictional plan', $2) returning id`,
      [userId, run.rows[0]!.id],
    );
    const planId = plan.rows[0]!.id;
    const legacyComplete = await pool.query<{ id: string }>(
      `insert into exercises (user_id, learning_plan_id, title, kind, status, position, updated_at)
       values ($1, $2, 'Legacy complete', 'kata', 'complete', 0, '2026-07-18T15:00:00+00') returning id`,
      [userId, planId],
    );
    const legacyPlanned = await pool.query<{ id: string }>(
      `insert into exercises (user_id, learning_plan_id, title, kind, position)
       values ($1, $2, 'Legacy planned', 'writeup', 1) returning id`,
      [userId, planId],
    );

    await applyMigrationFile(pool, target as string);

    // The DB's own ::date of the planted instant — the exact backfill
    // expression, so the assertion is timezone-self-consistent.
    const expected = await pool.query<{ d: string }>(
      `select ('2026-07-18T15:00:00+00'::timestamptz)::date::text as d`,
    );
    const backfilled = await pool.query<{ completed_on: string | null }>(
      `select completed_on::text from exercises where id = $1`,
      [legacyComplete.rows[0]!.id],
    );
    expect(backfilled.rows[0]!.completed_on).toBe(expected.rows[0]!.d);

    const untouched = await pool.query<{ completed_on: string | null }>(
      `select completed_on from exercises where id = $1`,
      [legacyPlanned.rows[0]!.id],
    );
    expect(untouched.rows[0]!.completed_on).toBeNull();

    // And the CHECK is live from this point on.
    await expect(
      pool.query(
        `insert into exercises (user_id, learning_plan_id, title, kind, status, position)
         values ($1, $2, 'x', 'kata', 'complete', 2)`,
        [userId, planId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
