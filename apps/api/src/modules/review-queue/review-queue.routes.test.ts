import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type Exercise, type ReviewQueueResponse } from '@careerforge/core';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import {
  buildTestEnv,
  createSessionRow,
  createTestUser,
  ORIGIN_HEADER,
} from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

// GET /review-queue (M3-05) — the spaced review queue over completed
// exercises, computed from the injected server clock on every read. The
// choreography completes exercises under one instance clock, records
// `revisited` evidence (the EXISTING write surface — this module adds none),
// then reads the queue under later clocks to pin due/not-yet/graduated/
// backdated/epoch-reset/strict-> boundary behavior. Every fixture is
// fictional (RISKS P-01).

const handle = createTestDb();
const env = buildTestEnv();
const { pool } = handle;

const instances: FastifyInstance[] = [];

beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await Promise.all(instances.map((instance) => instance.close()));
  instances.length = 0;
});
afterAll(() => handle.pool.end());

/** An app instance whose server clock is pinned to `isoInstant`. */
async function buildAt(isoInstant: string, deps: AppDeps = {}): Promise<FastifyInstance> {
  const instance = await buildApp(env, {
    dbHandle: handle,
    now: () => new Date(isoInstant),
    ...deps,
  });
  instances.push(instance);
  return instance;
}

let seq = 0;

async function makeUser() {
  seq += 1;
  const user = await createTestUser(handle, {
    email: `reviser.${seq}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  // Far-future expiry: the choreography reads the queue under clocks years
  // ahead (graduation is forever), which would outlive a default TTL session.
  const { token } = await createSessionRow(handle, user.id, new Date('2031-01-01T00:00:00Z'));
  return {
    user,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER },
  };
}

type Headers = { cookie: string };

/** A learning plan citing one fresh gap under one posting; raw SQL, fictional. */
async function seedPlanWithGap(userId: string): Promise<{ planId: string; gapIds: string[] }> {
  seq += 1;
  const hash = String(seq).padEnd(64, 'e').slice(0, 64);
  const posting = await pool.query<{ id: string }>(
    `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting', $2) returning id`,
    [userId, hash],
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
  const runId = run.rows[0]!.id;
  const report = await pool.query<{ id: string }>(
    `insert into fit_reports
       (user_id, posting_id, extraction_run_id, verdict, exclusions, criteria_snapshot,
        forced_lowest, input_flagged)
     values ($1, $2, $3, 'scored', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false) returning id`,
    [userId, posting.rows[0]!.id, runId],
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
  await pool.query(
    `insert into learning_plan_gaps (user_id, learning_plan_id, gap_id, focus, priority, position)
     values ($1, $2, $3, 'focus', 'high', 0)`,
    [userId, planId, gap.rows[0]!.id],
  );
  return { planId, gapIds: [gap.rows[0]!.id] };
}

/** Create an exercise, give it implemented+tested evidence, and complete it
 *  under `instance`'s clock. Returns the exercise id. */
async function completedExercise(
  instance: FastifyInstance,
  headers: Headers,
  userId: string,
  title: string,
): Promise<string> {
  const { planId, gapIds } = await seedPlanWithGap(userId);
  const created = await instance.inject({
    method: 'POST',
    url: '/exercises',
    headers,
    payload: { learningPlanId: planId, title, kind: 'kata', gapIds },
  });
  expect(created.statusCode).toBe(201);
  const exerciseId = created.json<Exercise>().id;
  for (const kind of ['implemented', 'tested']) {
    const evidence = await instance.inject({
      method: 'POST',
      url: '/mastery-evidence',
      headers,
      payload: { exerciseId, kind },
    });
    expect(evidence.statusCode).toBe(201);
  }
  const patched = await instance.inject({
    method: 'PATCH',
    url: `/exercises/${exerciseId}`,
    headers,
    payload: { status: 'complete' },
  });
  expect(patched.statusCode).toBe(200);
  return exerciseId;
}

async function recordRevisit(
  instance: FastifyInstance,
  headers: Headers,
  exerciseId: string,
  recordedOn?: string,
): Promise<void> {
  const res = await instance.inject({
    method: 'POST',
    url: '/mastery-evidence',
    headers,
    payload: { exerciseId, kind: 'revisited', ...(recordedOn ? { recordedOn } : {}) },
  });
  expect(res.statusCode).toBe(201);
}

async function readQueue(
  instance: FastifyInstance,
  headers: Headers,
): Promise<ReviewQueueResponse> {
  const res = await instance.inject({ method: 'GET', url: '/review-queue', headers });
  expect(res.statusCode).toBe(200);
  return res.json<ReviewQueueResponse>();
}

describe('GET /review-queue', () => {
  it('401s without a session', async () => {
    const instance = await buildAt('2026-07-20T12:00:00Z');
    const res = await instance.inject({ method: 'GET', url: '/review-queue' });
    expect(res.statusCode).toBe(401);
  });

  it('is empty for a user with no completed exercises (planned/in_progress never appear)', async () => {
    const instance = await buildAt('2026-07-20T12:00:00Z');
    const { user, headers } = await makeUser();
    const { planId, gapIds } = await seedPlanWithGap(user.id);
    const created = await instance.inject({
      method: 'POST',
      url: '/exercises',
      headers,
      payload: { learningPlanId: planId, title: 'Never completed', kind: 'writeup', gapIds },
    });
    expect(created.statusCode).toBe(201);
    expect(await readQueue(instance, headers)).toEqual({ items: [] });
  });

  it('lists a due k=0 exercise (completed+7) and hides a not-yet-due one', async () => {
    const early = await buildAt('2026-07-01T12:00:00Z');
    const { user, headers } = await makeUser();
    const dueId = await completedExercise(early, headers, user.id, 'Due kata');

    const mid = await buildAt('2026-07-15T12:00:00Z');
    await completedExercise(mid, headers, user.id, 'Fresh kata');

    const reader = await buildAt('2026-07-20T12:00:00Z');
    const queue = await readQueue(reader, headers);
    expect(queue.items).toHaveLength(1);
    // learningPlanId is pinned present-and-string by the strict response
    // schema; its value is the seeded plan's uuid.
    expect(queue.items[0]).toMatchObject({
      exerciseId: dueId,
      title: 'Due kata',
      kind: 'kata',
      completedOn: '2026-07-01',
      revisitCount: 0,
      intervalDays: 7,
      dueOn: '2026-07-08',
    });
  });

  it('rolls the ladder: after one revisit the next due is revisit+30 (k=1), listed once due', async () => {
    const early = await buildAt('2026-07-01T12:00:00Z');
    const { user, headers } = await makeUser();
    const exerciseId = await completedExercise(early, headers, user.id, 'Rolling kata');

    const reader = await buildAt('2026-07-20T12:00:00Z');
    await recordRevisit(reader, headers, exerciseId, '2026-07-08');

    // Due 2026-08-07 — not yet due at 07-20.
    expect((await readQueue(reader, headers)).items).toEqual([]);

    const later = await buildAt('2026-08-10T12:00:00Z');
    const queue = await readQueue(later, headers);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      exerciseId,
      revisitCount: 1,
      intervalDays: 30,
      dueOn: '2026-08-07',
    });
  });

  it('graduates after three counted revisits — gone forever, even years later', async () => {
    const early = await buildAt('2026-07-01T12:00:00Z');
    const { user, headers } = await makeUser();
    const exerciseId = await completedExercise(early, headers, user.id, 'Graduated kata');

    const reader = await buildAt('2026-07-20T12:00:00Z');
    for (const day of ['2026-07-08', '2026-07-10', '2026-07-12']) {
      await recordRevisit(reader, headers, exerciseId, day);
    }
    expect((await readQueue(reader, headers)).items).toEqual([]);

    const distant = await buildAt('2030-01-01T12:00:00Z');
    expect((await readQueue(distant, headers)).items).toEqual([]);
  });

  it('ignores revisits recorded before completion (backdated) and ON the completion day (strict >)', async () => {
    const early = await buildAt('2026-07-01T12:00:00Z');
    const { user, headers } = await makeUser();
    const backdatedId = await completedExercise(early, headers, user.id, 'Backdated kata');
    const sameDayId = await completedExercise(early, headers, user.id, 'Same-day kata');
    // Recorded BEFORE completion — prior work, not retention proof.
    await recordRevisit(early, headers, backdatedId, '2026-06-15');
    // Recorded ON the completion day — excluded by the strict > filter (with
    // >= this would count as k=1 and push dueOn to 07-31, hiding the item
    // below AND reporting revisitCount 1).
    await recordRevisit(early, headers, sameDayId, '2026-07-01');

    const reader = await buildAt('2026-07-20T12:00:00Z');
    const queue = await readQueue(reader, headers);
    expect(queue.items).toHaveLength(2);
    for (const item of queue.items) {
      expect(item).toMatchObject({ revisitCount: 0, intervalDays: 7, dueOn: '2026-07-08' });
    }
  });

  it('epoch reset: re-completion restamps the anchor and old-epoch revisits stop counting', async () => {
    const early = await buildAt('2026-07-01T12:00:00Z');
    const { user, headers } = await makeUser();
    const exerciseId = await completedExercise(early, headers, user.id, 'Epoch kata');

    const reopenDay = await buildAt('2026-07-20T12:00:00Z');
    await recordRevisit(reopenDay, headers, exerciseId, '2026-07-08'); // k=1, due 08-07
    // Reopen and re-complete on 07-20 — a NEW epoch (completed_on = 07-20).
    for (const status of ['in_progress', 'complete']) {
      const res = await reopenDay.inject({
        method: 'PATCH',
        url: `/exercises/${exerciseId}`,
        headers,
        payload: { status },
      });
      expect(res.statusCode).toBe(200);
    }

    // Old-epoch revisit (07-08 <= new completed_on) is excluded: k=0, due
    // 07-27. Without the reset the item would still be waiting on 08-07.
    const reader = await buildAt('2026-07-28T12:00:00Z');
    const queue = await readQueue(reader, headers);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      exerciseId,
      completedOn: '2026-07-20',
      revisitCount: 0,
      intervalDays: 7,
      dueOn: '2026-07-27',
    });
  });

  it('sorts (dueOn asc, exerciseId asc)', async () => {
    const early = await buildAt('2026-07-01T12:00:00Z');
    const { user, headers } = await makeUser();
    const first = await completedExercise(early, headers, user.id, 'Oldest due');
    const mid = await buildAt('2026-07-05T12:00:00Z');
    const second = await completedExercise(mid, headers, user.id, 'Newer due');

    const reader = await buildAt('2026-07-20T12:00:00Z');
    const queue = await readQueue(reader, headers);
    expect(queue.items.map((item) => [item.exerciseId, item.dueOn])).toEqual([
      [first, '2026-07-08'],
      [second, '2026-07-12'],
    ]);
  });

  it("never leaks another user's completed exercises", async () => {
    const instance = await buildAt('2026-07-20T12:00:00Z');
    const owner = await makeUser();
    await completedExercise(instance, owner.headers, owner.user.id, 'Owned kata');
    // Backdate the completion anchor so it is due (raw SQL: the service clock
    // for this instance is 07-20, making due 07-27 — not listed otherwise).
    await pool.query(`update exercises set completed_on = '2026-07-01'`);

    const stranger = await makeUser();
    expect(await readQueue(instance, stranger.headers)).toEqual({ items: [] });
    expect((await readQueue(instance, owner.headers)).items).toHaveLength(1);
  });
});
