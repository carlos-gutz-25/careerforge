import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from '../test/db-test-utils.ts';

// M15-01: proves the HAND-EDITED part of migration 0026 - the NOT VALID
// modifier drizzle-kit will not emit - does what it claims, in BOTH directions:
// the migration APPLIES over a pre-existing `flagged` row whose gate_violations
// is NULL (grandfathering, because the gate's reasons were never recorded for
// those rows), AND the constraint is still ENFORCED against every new INSERT.
//
// This cannot be tested on the regular test DB: those databases are created
// fresh and migrated from an EMPTY schema, so there is no legacy row to
// grandfather and a constraint with NOT VALID silently deleted would pass the
// whole gate trio and CI. The only machine that would fail is a developer's dev
// DB at `pnpm db:migrate` time, which is in neither. So a scratch DB replays the
// journal to 0025, plants the legacy row, then applies 0026 alone. The scratch
// DB is dropped in afterAll. All fixture values fictional (RISKS P-01).
//
// Follows migration-0014-backfill.test.ts, the repo's only precedent for testing
// a hand-edited migration - its MECHANISM (scratch DB, journal replay, planted
// rows, afterAll drop), deliberately not its prose bytes, which carry non-ASCII.

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'migrations');
const SCRATCH_DB = 'careerforge_migration0026_test';

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

/** Seed the ownership chain a compose run needs, on the pre-0026 schema. */
async function seedComposeChain(pool: pg.Pool): Promise<{ userId: string; reportId: string }> {
  const user = await pool.query<{ id: string }>(
    `insert into users (email, password_hash) values ('replay.fictional@example.com', 'fake-hash') returning id`,
  );
  const userId = user.rows[0]!.id;
  const posting = await pool.query<{ id: string }>(
    `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting text', 'hash-0026-replay') returning id`,
    [userId],
  );
  const run = await pool.query<{ id: string }>(
    `insert into extraction_runs
       (user_id, posting_id, provider, model, prompt_id, raw_response,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        latency_ms, attempt, status)
     values ($1, $2, 'anthropic', 'claude', 'extract@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok')
     returning id`,
    [userId, posting.rows[0]!.id],
  );
  const report = await pool.query<{ id: string }>(
    `insert into fit_reports
       (user_id, posting_id, extraction_run_id, verdict, exclusions, criteria_snapshot,
        forced_lowest, input_flagged)
     values ($1, $2, $3, 'scored', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false) returning id`,
    [userId, posting.rows[0]!.id, run.rows[0]!.id],
  );
  return { userId, reportId: report.rows[0]!.id };
}

function insertComposeRun(
  pool: pg.Pool,
  userId: string,
  reportId: string,
  status: string,
): Promise<pg.QueryResult<{ id: string }>> {
  return pool.query<{ id: string }>(
    `insert into resume_compose_runs
       (user_id, fit_report_id, provider, model, prompt_id, raw_response,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        latency_ms, attempt, status)
     values ($1, $2, 'anthropic', 'claude-sonnet-5', 'resume-compose@v1', '{}'::jsonb,
             0, 0, 0, 0, 0, 1, $3)
     returning id`,
    [userId, reportId, status],
  );
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

describe('migration 0026 NOT VALID grandfathering (scratch DB replay)', () => {
  it('applies over a legacy flagged+NULL row AND still rejects new ones', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const target = files.find((f) => f.startsWith('0026_'));
    expect(target, 'migration 0026 must exist').toBeDefined();
    const before = files.filter((f) => f < (target as string));

    for (const file of before) await applyMigrationFile(pool, file);

    // Pre-0026 world: a flagged run carries no violations column at all. This is
    // the incident's own shape - the row that made the gate mute.
    const { userId, reportId } = await seedComposeChain(pool);
    const legacyFlagged = await insertComposeRun(pool, userId, reportId, 'flagged');
    const legacyId = legacyFlagged.rows[0]!.id;

    // HALF ONE: the migration APPLIES despite that row violating the new CHECK.
    // A validated constraint would fail here, which is the whole reason for the
    // hand edit. If NOT VALID were silently dropped, this line throws.
    await applyMigrationFile(pool, target as string);

    const grandfathered = await pool.query<{ gate_violations: unknown; status: string }>(
      `select gate_violations, status from resume_compose_runs where id = $1`,
      [legacyId],
    );
    expect(grandfathered.rows[0]!.status).toBe('flagged');
    expect(grandfathered.rows[0]!.gate_violations).toBeNull();

    // HALF TWO: enforcement is LIVE. NOT VALID skips the scan of existing rows;
    // it does NOT stop the constraint applying to every INSERT and UPDATE.
    await expect(insertComposeRun(pool, userId, reportId, 'flagged')).rejects.toMatchObject({
      code: '23514',
    });

    // ...and the constraint really is marked NOT VALID, rather than the legacy
    // row having been quietly mutated to satisfy a validated one.
    const convalidated = await pool.query<{ convalidated: boolean }>(
      `select convalidated from pg_constraint where conname = 'resume_compose_runs_gate_violations_check'`,
    );
    expect(convalidated.rows[0]!.convalidated).toBe(false);
  });
});
