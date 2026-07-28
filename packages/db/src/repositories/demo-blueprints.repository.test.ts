import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import {
  createDemoBlueprintsRepository,
  type DemoBlueprintSnapshot,
} from './demo-blueprints.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M9-04 demo-blueprint persistence + reads (dockerized
// Postgres, migration 0022). Fixtures seeded with raw SQL through the pool (the
// fit chain behind a gap) and are all fictional (RISKS P-01). The R9
// posting-deletion-survival behavior is pinned here (the named privacy-coherence
// deviation): a blueprint OUTLIVES the deletion of the posting behind it.

const handle = createTestDb();
const { pool } = handle;
const users = createUsersRepository(handle.db);
const blueprints = createDemoBlueprintsRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

let seq = 0;

async function seedUser(): Promise<string> {
  seq += 1;
  const user = await users.create({
    email: `bp.fictional.${String(seq)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  return user.id;
}

/** One posting -> run -> requirement -> fit_report -> gap; returns the posting id
 *  (for the survival test) and the gap id (the blueprint anchor). */
async function seedGap(userId: string): Promise<{ postingId: string; gapId: string }> {
  seq += 1;
  const hash = String(seq).padEnd(64, 'e').slice(0, 64);
  const posting = await pool.query<{ id: string }>(
    `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting', $2) returning id`,
    [userId, hash],
  );
  const postingId = posting.rows[0]!.id;
  const run = await pool.query<{ id: string }>(
    `insert into extraction_runs
       (user_id, posting_id, provider, model, prompt_id, raw_response,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        latency_ms, attempt, status)
     values ($1, $2, 'anthropic', 'claude', 'extract@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok')
     returning id`,
    [userId, postingId],
  );
  const runId = run.rows[0]!.id;
  const report = await pool.query<{ id: string }>(
    `insert into fit_reports
       (user_id, posting_id, extraction_run_id, verdict, exclusions, criteria_snapshot,
        forced_lowest, input_flagged)
     values ($1, $2, $3, 'scored', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false) returning id`,
    [userId, postingId, runId],
  );
  const req = await pool.query<{ id: string }>(
    `insert into requirements
       (user_id, extraction_run_id, kind, category, text, source_quote, confidence, position)
     values ($1, $2, 'must_have', 'framework', 'Fictional requirement', 'Fictional requirement', 0.9, 0)
     returning id`,
    [userId, runId],
  );
  const gap = await pool.query<{ id: string }>(
    `insert into gaps
       (user_id, fit_report_id, requirement_id, classification, engine_classification, rationale)
     values ($1, $2, $3, 'genuine_gap', 'genuine_gap', 'fictional') returning id`,
    [userId, report.rows[0]!.id, req.rows[0]!.id],
  );
  return { postingId, gapId: gap.rows[0]!.id };
}

function snapshot(
  gapId: string | null,
  overrides: Partial<DemoBlueprintSnapshot> = {},
): DemoBlueprintSnapshot {
  return {
    gapId,
    groupKey: 'kubernetes operators',
    requirementText: 'Experience building Kubernetes operators',
    title: 'Kubernetes operators',
    scorerVersion: 1,
    postingCount: 3,
    instanceCount: 5,
    mustHavePostingCount: 2,
    niceToHavePostingCount: 1,
    categories: ['framework'],
    refs: gapId
      ? [
          {
            gapId,
            postingId: '33333333-3333-4333-8333-333333333333',
            fitReportId: '44444444-4444-4444-8444-444444444444',
            classification: 'genuine_gap',
          },
        ]
      : [],
    problem: 'problem text',
    constraints: 'constraints text',
    deliverables: 'deliverables text',
    evidenceRequired: 'evidence text',
    ...overrides,
  };
}

describe('createDemoBlueprintsRepository (M9-04)', () => {
  it('inserts a blueprint with the DB-generated md5 hash and reads it back', async () => {
    const userId = await seedUser();
    const { gapId } = await seedGap(userId);
    const row = await blueprints.insert(userId, snapshot(gapId));
    expect(row.groupKey).toBe('kubernetes operators');
    expect(row.categories).toEqual(['framework']);
    expect(row.postingCount).toBe(3);
    // Owner read + group-key (md5) dispatch both find it.
    expect((await blueprints.findById(userId, row.id))?.id).toBe(row.id);
    expect((await blueprints.findByGroupKey(userId, 'kubernetes operators'))?.id).toBe(row.id);
  });

  it('findById and findByGroupKey are owner-scoped', async () => {
    const userId = await seedUser();
    const { gapId } = await seedGap(userId);
    const row = await blueprints.insert(userId, snapshot(gapId));
    const strangerId = await seedUser();
    expect(await blueprints.findById(strangerId, row.id)).toBeUndefined();
    expect(await blueprints.findByGroupKey(strangerId, 'kubernetes operators')).toBeUndefined();
  });

  it('enforces one blueprint per (user, group_key) via the generated hash (23505)', async () => {
    const userId = await seedUser();
    const { gapId } = await seedGap(userId);
    await blueprints.insert(userId, snapshot(gapId));
    await expect(blueprints.insert(userId, snapshot(gapId))).rejects.toSatisfy(
      (e: unknown) => pgErrorCode(e) === '23505',
      'expected unique_violation',
    );
  });

  it('updateSnapshotById refreshes in place (same id, full replacement)', async () => {
    const userId = await seedUser();
    const { gapId } = await seedGap(userId);
    const other = await seedGap(userId);
    const row = await blueprints.insert(userId, snapshot(gapId));
    const refreshed = await blueprints.updateSnapshotById(
      userId,
      row.id,
      snapshot(other.gapId, { postingCount: 9, title: 'Renamed', instanceCount: 12 }),
    );
    expect(refreshed?.id).toBe(row.id); // same row
    expect(refreshed?.postingCount).toBe(9); // re-snapshotted
    expect(refreshed?.title).toBe('Renamed');
    expect(refreshed?.gapId).toBe(other.gapId); // re-anchored
    // Foreign refresh is a no-op (undefined = 404).
    const strangerId = await seedUser();
    expect(
      await blueprints.updateSnapshotById(strangerId, row.id, snapshot(gapId)),
    ).toBeUndefined();
  });

  it('lists a user blueprints newest-first (created_at desc, id desc)', async () => {
    const userId = await seedUser();
    const g1 = await seedGap(userId);
    const g2 = await seedGap(userId);
    const older = await blueprints.insert(userId, snapshot(g1.gapId, { groupKey: 'alpha' }));
    // Age `older` by an hour so the created_at ordering is unambiguous (node-pg
    // truncates timestamptz to ms, so same-instant rows can't be order-tested).
    await pool.query(
      `update demo_blueprints set created_at = now() - interval '1 hour' where id = $1`,
      [older.id],
    );
    const newer = await blueprints.insert(userId, snapshot(g2.gapId, { groupKey: 'beta' }));
    const list = await blueprints.list(userId);
    expect(list.map((row) => row.id)).toEqual([newer.id, older.id]);
    // Deterministic: a second call yields the identical order.
    const again = await blueprints.list(userId);
    expect(again.map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  it('deleteById is owner-scoped', async () => {
    const userId = await seedUser();
    const { gapId } = await seedGap(userId);
    const row = await blueprints.insert(userId, snapshot(gapId));
    const strangerId = await seedUser();
    expect(await blueprints.deleteById(strangerId, row.id)).toBe(false);
    expect(await blueprints.deleteById(userId, row.id)).toBe(true);
    expect(await blueprints.deleteById(userId, row.id)).toBe(false);
  });

  it('gap delete SET-NULLs gap_id; the blueprint row + read survive', async () => {
    const userId = await seedUser();
    const { gapId } = await seedGap(userId);
    const row = await blueprints.insert(userId, snapshot(gapId));
    await pool.query(`delete from gaps where id = $1`, [gapId]);
    const after = await blueprints.findById(userId, row.id);
    expect(after).toBeDefined();
    expect(after?.gapId).toBeNull();
    // The snapshot text is untouched (the durable record).
    expect(after?.requirementText).toBe('Experience building Kubernetes operators');
  });

  it('R9: deleting the LAST posting behind a blueprint leaves the row + read alive, gap_id NULL', async () => {
    const userId = await seedUser();
    const { postingId, gapId } = await seedGap(userId);
    const row = await blueprints.insert(userId, snapshot(gapId));
    // Deleting the posting cascades the run/requirement/report/gap away; the
    // blueprint deliberately SURVIVES (the named privacy-coherence deviation).
    await pool.query(`delete from job_postings where id = $1`, [postingId]);
    const gapsLeft = await pool.query<{ n: string }>(`select count(*)::text as n from gaps`);
    expect(gapsLeft.rows[0]!.n).toBe('0');
    const after = await blueprints.findById(userId, row.id);
    expect(after).toBeDefined();
    expect(after?.gapId).toBeNull();
    expect(after?.groupKey).toBe('kubernetes operators');
  });
});
