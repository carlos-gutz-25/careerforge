import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { createExercisesRepository } from './exercises.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M3-02 exercise persistence + reads (dockerized
// Postgres, migration 0011). Fixtures are seeded with raw SQL through the pool
// (the plan/gap chain) and are all fictional (RISKS P-01).

const handle = createTestDb();
const { pool } = handle;
const users = createUsersRepository(handle.db);
const exercises = createExercisesRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

let seq = 0;

async function seedUser(): Promise<string> {
  seq += 1;
  const user = await users.create({
    email: `ex.fictional.${String(seq)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  return user.id;
}

/** A learning plan citing `gapCount` fresh gaps under one posting; returns the
 *  plan id and its cited gap ids in citation order. */
async function seedPlanWithGaps(
  userId: string,
  gapCount: number,
): Promise<{ planId: string; gapIds: string[] }> {
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
  const reportId = report.rows[0]!.id;
  const gapIds: string[] = [];
  for (let i = 0; i < gapCount; i += 1) {
    const req = await pool.query<{ id: string }>(
      `insert into requirements
         (user_id, extraction_run_id, kind, category, text, source_quote, confidence, position)
       values ($1, $2, 'must_have', 'framework', $3, $3, 0.9, $4) returning id`,
      [userId, runId, `Skill ${String(i)}`, i],
    );
    const gap = await pool.query<{ id: string }>(
      `insert into gaps
         (user_id, fit_report_id, requirement_id, classification, engine_classification, rationale)
       values ($1, $2, $3, 'genuine_gap', 'genuine_gap', 'fictional') returning id`,
      [userId, reportId, req.rows[0]!.id],
    );
    gapIds.push(gap.rows[0]!.id);
  }
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
  for (const [i, gapId] of gapIds.entries()) {
    await pool.query(
      `insert into learning_plan_gaps (user_id, learning_plan_id, gap_id, focus, priority, position)
       values ($1, $2, $3, 'focus', 'high', $4)`,
      [userId, planId, gapId, i],
    );
  }
  return { planId, gapIds };
}

describe('createExercisesRepository (M3-02)', () => {
  describe('findPlanCitedGapIds', () => {
    it('returns the plan cited gap ids, or undefined for missing/foreign plan', async () => {
      const userId = await seedUser();
      const { planId, gapIds } = await seedPlanWithGaps(userId, 3);
      const found = await exercises.findPlanCitedGapIds(userId, planId);
      expect(found).toBeDefined();
      expect([...found!].sort()).toEqual([...gapIds].sort());

      // Unknown id -> undefined (the 404 outcome).
      expect(
        await exercises.findPlanCitedGapIds(userId, '99999999-9999-4999-8999-999999999999'),
      ).toBeUndefined();

      // Another user's plan is invisible -> undefined.
      const otherId = await seedUser();
      expect(await exercises.findPlanCitedGapIds(otherId, planId)).toBeUndefined();
    });
  });

  describe('createExercise + reads', () => {
    it('creates an exercise with links, assigns append positions, sorts gapIds', async () => {
      const userId = await seedUser();
      const { planId, gapIds } = await seedPlanWithGaps(userId, 3);

      const first = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'First kata',
        kind: 'kata',
        gapIds: [gapIds[1]!, gapIds[0]!],
      });
      expect(first.row.position).toBe(0);
      expect(first.row.status).toBe('planned');
      expect(first.gapIds).toEqual([gapIds[1]!, gapIds[0]!].sort());

      const second = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'Second project',
        kind: 'project',
        gapIds: [gapIds[2]!],
      });
      // Server-assigned append order: next after the existing max.
      expect(second.row.position).toBe(1);

      const list = await exercises.listExercisesByPlan(userId, planId);
      expect(list.map((e) => e.row.title)).toEqual(['First kata', 'Second project']);
      expect(list[0]!.gapIds).toEqual([gapIds[0]!, gapIds[1]!].sort());
    });

    it('findExercise is owner-scoped', async () => {
      const userId = await seedUser();
      const { planId, gapIds } = await seedPlanWithGaps(userId, 1);
      const created = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'Owned',
        kind: 'writeup',
        gapIds,
      });
      expect((await exercises.findExercise(userId, created.row.id))?.row.title).toBe('Owned');

      const otherId = await seedUser();
      expect(await exercises.findExercise(otherId, created.row.id)).toBeUndefined();
    });
  });

  describe('updateExerciseStatus', () => {
    it('updates status + completedOn only and is owner-scoped', async () => {
      const userId = await seedUser();
      const { planId, gapIds } = await seedPlanWithGaps(userId, 1);
      const created = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'Lifecycle',
        kind: 'interview_drill',
        gapIds,
      });

      const updated = await exercises.updateExerciseStatus(
        userId,
        created.row.id,
        'in_progress',
        null,
      );
      expect(updated?.row.status).toBe('in_progress');
      expect(updated?.row.completedOn).toBeNull();
      // Title/kind/links untouched.
      expect(updated?.row.title).toBe('Lifecycle');
      expect(updated?.gapIds).toEqual(gapIds);

      const otherId = await seedUser();
      expect(
        await exercises.updateExerciseStatus(otherId, created.row.id, 'complete', '2026-07-20'),
      ).toBeUndefined();
    });

    it('stamp round-trip: complete stores the date, leaving complete clears it (M3-05)', async () => {
      const userId = await seedUser();
      const { planId, gapIds } = await seedPlanWithGaps(userId, 1);
      const created = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'Stamped',
        kind: 'kata',
        gapIds,
      });

      const completed = await exercises.updateExerciseStatus(
        userId,
        created.row.id,
        'complete',
        '2026-07-20',
      );
      expect(completed?.row.status).toBe('complete');
      expect(completed?.row.completedOn).toBe('2026-07-20');

      const reopened = await exercises.updateExerciseStatus(
        userId,
        created.row.id,
        'in_progress',
        null,
      );
      expect(reopened?.row.completedOn).toBeNull();
    });
  });

  describe('listCompletedExercises (M3-05 review-queue read)', () => {
    it('returns only complete exercises of the caller, id-ordered, with the anchor date', async () => {
      const userId = await seedUser();
      const { planId, gapIds } = await seedPlanWithGaps(userId, 1);
      const done = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'Done',
        kind: 'kata',
        gapIds,
      });
      await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'Still planned',
        kind: 'writeup',
        gapIds,
      });
      await exercises.updateExerciseStatus(userId, done.row.id, 'complete', '2026-07-18');

      // A completed exercise of ANOTHER user never leaks in.
      const otherId = await seedUser();
      const other = await seedPlanWithGaps(otherId, 1);
      const foreign = await exercises.createExercise(otherId, {
        learningPlanId: other.planId,
        title: 'Foreign complete',
        kind: 'project',
        gapIds: other.gapIds,
      });
      await exercises.updateExerciseStatus(otherId, foreign.row.id, 'complete', '2026-07-19');

      const listed = await exercises.listCompletedExercises(userId);
      expect(listed).toEqual([
        {
          id: done.row.id,
          title: 'Done',
          kind: 'kata',
          learningPlanId: planId,
          completedOn: '2026-07-18',
        },
      ]);
    });
  });

  describe('deleteExercise', () => {
    it('deletes owner-scoped and reports whether a row was removed', async () => {
      const userId = await seedUser();
      const { planId, gapIds } = await seedPlanWithGaps(userId, 1);
      const created = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'Deletable',
        kind: 'kata',
        gapIds,
      });

      // Foreign delete is a no-op (false = 404).
      const otherId = await seedUser();
      expect(await exercises.deleteExercise(otherId, created.row.id)).toBe(false);
      expect(await exercises.findExercise(userId, created.row.id)).toBeDefined();

      // Owner delete removes the row (and cascades its links).
      expect(await exercises.deleteExercise(userId, created.row.id)).toBe(true);
      expect(await exercises.findExercise(userId, created.row.id)).toBeUndefined();
      const links = await pool.query<{ n: string }>(`select count(*) as n from exercise_gaps`);
      expect(links.rows[0]!.n).toBe('0');

      // Deleting again reports false.
      expect(await exercises.deleteExercise(userId, created.row.id)).toBe(false);
    });
  });

  describe('listExercisesCitingGaps (M9-04 D5)', () => {
    it('returns [] for empty gap input', async () => {
      const userId = await seedUser();
      expect(await exercises.listExercisesCitingGaps(userId, [])).toEqual([]);
    });

    it('returns distinct citing exercises, deduped, ordered, owner-scoped', async () => {
      const userId = await seedUser();
      const { planId, gapIds } = await seedPlanWithGaps(userId, 3);
      // exA cites two of the queried gaps (must appear ONCE), exB cites one,
      // exC cites only a gap OUTSIDE the query set (must not appear).
      const exA = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'A',
        kind: 'project',
        gapIds: [gapIds[0]!, gapIds[1]!],
      });
      const exB = await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'B',
        kind: 'writeup',
        gapIds: [gapIds[1]!],
      });
      await exercises.createExercise(userId, {
        learningPlanId: planId,
        title: 'C',
        kind: 'kata',
        gapIds: [gapIds[2]!],
      });

      const result = await exercises.listExercisesCitingGaps(userId, [gapIds[0]!, gapIds[1]!]);
      // exA (deduped to one row) and exB only.
      expect(result.map((e) => e.row.id).sort()).toEqual([exA.row.id, exB.row.id].sort());
      // Each carries its FULL gap ids (exA still shows both of its citations).
      const rowA = result.find((e) => e.row.id === exA.row.id)!;
      expect(rowA.gapIds).toEqual([gapIds[0]!, gapIds[1]!].sort());
      // Deterministic (created_at asc, id asc): non-decreasing across the result.
      for (let i = 1; i < result.length; i += 1) {
        const prev = result[i - 1]!.row;
        const curr = result[i]!.row;
        const prevMs = prev.createdAt.getTime();
        const currMs = curr.createdAt.getTime();
        expect(prevMs < currMs || (prevMs === currMs && prev.id <= curr.id)).toBe(true);
      }

      // A stranger querying the same gap ids sees nothing (user-scoped).
      const strangerId = await seedUser();
      expect(await exercises.listExercisesCitingGaps(strangerId, [gapIds[0]!, gapIds[1]!])).toEqual(
        [],
      );
    });
  });
});
