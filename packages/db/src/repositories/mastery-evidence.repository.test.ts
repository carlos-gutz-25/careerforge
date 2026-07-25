import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { createExercisesRepository } from './exercises.repository.ts';
import { createMasteryEvidenceRepository } from './mastery-evidence.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M3-03 mastery-evidence persistence + reads
// (dockerized Postgres, migration 0012). Fixtures use raw SQL through the pool
// for the plan/gap chain and are all fictional (RISKS P-01).

const handle = createTestDb();
const { pool } = handle;
const users = createUsersRepository(handle.db);
const exercises = createExercisesRepository(handle.db);
const evidence = createMasteryEvidenceRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

let seq = 0;

async function seedUser(): Promise<string> {
  seq += 1;
  const user = await users.create({
    email: `me.fictional.${String(seq)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  return user.id;
}

/** One plan citing one fresh gap, plus one exercise under it. Returns the
 *  exercise id (what evidence hangs off). */
async function seedExercise(userId: string): Promise<string> {
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
     values ($1, $2, 'must_have', 'framework', 'Skill', 'Skill', 0.9, 0) returning id`,
    [userId, runId],
  );
  const gap = await pool.query<{ id: string }>(
    `insert into gaps
       (user_id, fit_report_id, requirement_id, classification, engine_classification, rationale)
     values ($1, $2, $3, 'genuine_gap', 'genuine_gap', 'fictional') returning id`,
    [userId, report.rows[0]!.id, req.rows[0]!.id],
  );
  const lrun = await pool.query<{ id: string }>(
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
    [userId, lrun.rows[0]!.id],
  );
  const planId = plan.rows[0]!.id;
  const gapId = gap.rows[0]!.id;
  await pool.query(
    `insert into learning_plan_gaps (user_id, learning_plan_id, gap_id, focus, priority, position)
     values ($1, $2, $3, 'focus', 'high', 0)`,
    [userId, planId, gapId],
  );
  const exercise = await exercises.createExercise(userId, {
    learningPlanId: planId,
    title: 'Fictional exercise',
    kind: 'kata',
    gapIds: [gapId],
  });
  return exercise.row.id;
}

describe('createMasteryEvidenceRepository (M3-03)', () => {
  it('creates evidence and reads it back (owner-scoped); missing/foreign -> undefined', async () => {
    const userId = await seedUser();
    const exerciseId = await seedExercise(userId);
    const created = await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'implemented',
      artifactUrl: 'https://github.com/alex/repo/pull/1',
      recordedOn: '2026-07-20',
    });
    expect(created.kind).toBe('implemented');
    expect(created.recordedOn).toBe('2026-07-20');
    expect(created.artifactUrl).toBe('https://github.com/alex/repo/pull/1');

    const found = await evidence.findEvidence(userId, created.id);
    expect(found?.id).toBe(created.id);

    // Unknown id -> undefined (404).
    expect(
      await evidence.findEvidence(userId, '99999999-9999-4999-8999-999999999999'),
    ).toBeUndefined();
    // Another user cannot see it -> undefined.
    const otherId = await seedUser();
    expect(await evidence.findEvidence(otherId, created.id)).toBeUndefined();
  });

  it('stores a null artifactUrl (an explained/verbal record with no link)', async () => {
    const userId = await seedUser();
    const exerciseId = await seedExercise(userId);
    const created = await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'explained',
      artifactUrl: null,
      recordedOn: '2026-07-20',
    });
    expect(created.artifactUrl).toBeNull();
  });

  it('hasRequiredEvidence needs BOTH implemented and tested (the D1 gate read)', async () => {
    const userId = await seedUser();
    const exerciseId = await seedExercise(userId);
    expect(await evidence.hasRequiredEvidence(userId, exerciseId)).toBe(false);

    await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'implemented',
      artifactUrl: null,
      recordedOn: '2026-07-20',
    });
    // Only implemented so far — not enough.
    expect(await evidence.hasRequiredEvidence(userId, exerciseId)).toBe(false);
    // An explained row does NOT satisfy the gate (passive/tangential counts for
    // nothing).
    await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'explained',
      artifactUrl: null,
      recordedOn: '2026-07-20',
    });
    expect(await evidence.hasRequiredEvidence(userId, exerciseId)).toBe(false);

    await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'tested',
      artifactUrl: null,
      recordedOn: '2026-07-20',
    });
    // Now both implemented and tested exist.
    expect(await evidence.hasRequiredEvidence(userId, exerciseId)).toBe(true);
  });

  it('countEvidenceByKind returns per-kind counts with recurrence (the D2 guard read)', async () => {
    const userId = await seedUser();
    const exerciseId = await seedExercise(userId);
    expect(await evidence.countEvidenceByKind(userId, exerciseId)).toEqual({
      implemented: 0,
      tested: 0,
      explained: 0,
      revisited: 0,
    });
    await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'implemented',
      artifactUrl: null,
      recordedOn: '2026-07-20',
    });
    await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'implemented',
      artifactUrl: null,
      recordedOn: '2026-07-21',
    });
    await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'tested',
      artifactUrl: null,
      recordedOn: '2026-07-22',
    });
    expect(await evidence.countEvidenceByKind(userId, exerciseId)).toEqual({
      implemented: 2,
      tested: 1,
      explained: 0,
      revisited: 0,
    });
  });

  it('listEvidenceByExerciseIds batches by exercise id, owner-scoped (D4 embed)', async () => {
    const userId = await seedUser();
    const exerciseA = await seedExercise(userId);
    const exerciseB = await seedExercise(userId);
    await evidence.createEvidence(userId, {
      exerciseId: exerciseA,
      kind: 'implemented',
      artifactUrl: null,
      recordedOn: '2026-07-20',
    });
    await evidence.createEvidence(userId, {
      exerciseId: exerciseA,
      kind: 'tested',
      artifactUrl: null,
      recordedOn: '2026-07-21',
    });
    await evidence.createEvidence(userId, {
      exerciseId: exerciseB,
      kind: 'revisited',
      artifactUrl: null,
      recordedOn: '2026-07-22',
    });

    const grouped = await evidence.listEvidenceByExerciseIds(userId, [exerciseA, exerciseB]);
    expect(grouped.get(exerciseA)?.map((row) => row.kind)).toEqual(['implemented', 'tested']);
    expect(grouped.get(exerciseB)?.map((row) => row.kind)).toEqual(['revisited']);

    // Empty input -> empty map (no query).
    expect((await evidence.listEvidenceByExerciseIds(userId, [])).size).toBe(0);
    // Another user sees none of these exercises' evidence.
    const otherId = await seedUser();
    expect((await evidence.listEvidenceByExerciseIds(otherId, [exerciseA, exerciseB])).size).toBe(
      0,
    );
  });

  it('deleteEvidence is owner-scoped and reports rows-affected (404 disambiguation)', async () => {
    const userId = await seedUser();
    const exerciseId = await seedExercise(userId);
    const created = await evidence.createEvidence(userId, {
      exerciseId,
      kind: 'implemented',
      artifactUrl: null,
      recordedOn: '2026-07-20',
    });
    // Another user cannot delete it.
    const otherId = await seedUser();
    expect(await evidence.deleteEvidence(otherId, created.id)).toBe(false);
    // The owner can.
    expect(await evidence.deleteEvidence(userId, created.id)).toBe(true);
    // Gone now.
    expect(await evidence.deleteEvidence(userId, created.id)).toBe(false);
  });
});
