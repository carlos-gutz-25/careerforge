// POST/PATCH/DELETE /exercises + the GET /learning-plans/:id embed integration
// tests (M3-02). Every posting, requirement, and plan here is fictional (RISKS
// P-01). Laws pinned: an exercise may only cite gaps its own plan cites (the
// planted-FAIL: a cross-plan gap id → 409 EXERCISE_GAP_NOT_IN_PLAN); PATCH is
// status-only; DELETE is the owner-scoped mis-create recourse; the plan embeds
// its exercises (D3); no title text ever enters logs.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type Exercise, type LearningPlanResponse } from '@careerforge/core';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();
const { pool } = handle;

let app: FastifyInstance | undefined;

beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => handle.pool.end());

async function build(deps: AppDeps = {}): Promise<FastifyInstance> {
  app = await buildApp(env, { dbHandle: handle, ...deps });
  return app;
}

let seq = 0;
async function authed(instance: FastifyInstance) {
  seq += 1;
  const user = await createTestUser(handle, {
    email: `exerciser.${seq}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };
  return {
    user,
    headers,
    create: (payload: unknown, extra: Record<string, string> = {}) =>
      instance.inject({
        method: 'POST',
        url: '/exercises',
        headers: { ...headers, ...extra },
        payload: payload as Record<string, unknown>,
      }),
    patch: (id: string, payload: unknown) =>
      instance.inject({
        method: 'PATCH',
        url: `/exercises/${id}`,
        headers,
        payload: payload as Record<string, unknown>,
      }),
    remove: (id: string) => instance.inject({ method: 'DELETE', url: `/exercises/${id}`, headers }),
    getPlan: (planId: string) =>
      instance.inject({ method: 'GET', url: `/learning-plans/${planId}`, headers }),
  };
}

/** A learning plan citing `gapCount` fresh gaps under one posting; raw SQL, all
 *  fictional. Returns the plan id and its cited gap ids in citation order. */
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

describe('POST /exercises', () => {
  it('401s without a session', async () => {
    const instance = await build();
    const anon = await instance.inject({
      method: 'POST',
      url: '/exercises',
      payload: {
        learningPlanId: '11111111-1111-4111-8111-111111111111',
        title: 'x',
        kind: 'kata',
        gapIds: ['22222222-2222-4222-8222-222222222222'],
      },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const planner = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(planner.user.id, 1);
    const res = await planner.create(
      { learningPlanId: planId, title: 'Kata', kind: 'kata', gapIds },
      { origin: 'https://fictional-evil.example' },
    );
    expect(res.statusCode).toBe(403);
  });

  it('201s and returns the created exercise (position 0, planned, sorted gapIds)', async () => {
    const instance = await build();
    const planner = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(planner.user.id, 2);
    const res = await planner.create({
      learningPlanId: planId,
      title: 'Rebuild the failover drill',
      kind: 'project',
      gapIds: [gapIds[1]!, gapIds[0]!],
    });
    expect(res.statusCode).toBe(201);
    const exercise = res.json<Exercise>();
    expect(exercise.learningPlanId).toBe(planId);
    expect(exercise.kind).toBe('project');
    expect(exercise.status).toBe('planned');
    expect(exercise.position).toBe(0);
    expect(exercise.gapIds).toEqual([...gapIds].sort());
  });

  it('404s when the learning plan is missing or foreign', async () => {
    const instance = await build();
    const planner = await authed(instance);
    const { gapIds } = await seedPlanWithGaps(planner.user.id, 1);
    const missing = await planner.create({
      learningPlanId: '99999999-9999-4999-8999-999999999999',
      title: 'x',
      kind: 'kata',
      gapIds,
    });
    expect(missing.statusCode).toBe(404);

    // Another user's plan is a 404, not a 200.
    const other = await authed(instance);
    const owned = await seedPlanWithGaps(other.user.id, 1);
    const foreign = await planner.create({
      learningPlanId: owned.planId,
      title: 'x',
      kind: 'kata',
      gapIds: owned.gapIds,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('409s EXERCISE_GAP_NOT_IN_PLAN when citing a gap from a DIFFERENT plan (planted-FAIL)', async () => {
    const instance = await build();
    const planner = await authed(instance);
    const planA = await seedPlanWithGaps(planner.user.id, 1);
    const planB = await seedPlanWithGaps(planner.user.id, 1);
    // Same owner, but planA is asked to cite planB's gap — the membership gate.
    const res = await planner.create({
      learningPlanId: planA.planId,
      title: 'Cross-plan attempt',
      kind: 'kata',
      gapIds: planB.gapIds,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('EXERCISE_GAP_NOT_IN_PLAN');
  });
});

describe('GET /learning-plans/:id embed (D3)', () => {
  it('embeds the plan exercises, each with the gap ids it addresses', async () => {
    const instance = await build();
    const planner = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(planner.user.id, 2);
    const created = await planner.create({
      learningPlanId: planId,
      title: 'Embedded kata',
      kind: 'kata',
      gapIds: [gapIds[0]!],
    });
    const exerciseId = created.json<Exercise>().id;

    const res = await planner.getPlan(planId);
    expect(res.statusCode).toBe(200);
    const plan = res.json<LearningPlanResponse>().plan;
    expect(plan?.exercises).toHaveLength(1);
    expect(plan?.exercises[0]!.id).toBe(exerciseId);
    expect(plan?.exercises[0]!.gapIds).toEqual([gapIds[0]!]);
  });
});

describe('PATCH /exercises/:id', () => {
  it('updates status only and 404s a foreign exercise', async () => {
    const instance = await build();
    const planner = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(planner.user.id, 1);
    const created = await planner.create({
      learningPlanId: planId,
      title: 'Lifecycle',
      kind: 'interview_drill',
      gapIds,
    });
    const exerciseId = created.json<Exercise>().id;

    const patched = await planner.patch(exerciseId, { status: 'in_progress' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<Exercise>().status).toBe('in_progress');

    // An unknown status is a value-free 400.
    const bad = await planner.patch(exerciseId, { status: 'dropped' });
    expect(bad.statusCode).toBe(400);

    const other = await authed(instance);
    const foreign = await other.patch(exerciseId, { status: 'complete' });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('DELETE /exercises/:id', () => {
  it('204s, removes it from the embed, and 404s a foreign or repeat delete', async () => {
    const instance = await build();
    const planner = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(planner.user.id, 1);
    const created = await planner.create({
      learningPlanId: planId,
      title: 'Deletable',
      kind: 'kata',
      gapIds,
    });
    const exerciseId = created.json<Exercise>().id;

    // Foreign delete is a 404 (and does not remove the row).
    const other = await authed(instance);
    expect((await other.remove(exerciseId)).statusCode).toBe(404);

    const deleted = await planner.remove(exerciseId);
    expect(deleted.statusCode).toBe(204);

    const plan = (await planner.getPlan(planId)).json<LearningPlanResponse>().plan;
    expect(plan?.exercises).toHaveLength(0);

    // Deleting again is a 404.
    expect((await planner.remove(exerciseId)).statusCode).toBe(404);
  });
});
