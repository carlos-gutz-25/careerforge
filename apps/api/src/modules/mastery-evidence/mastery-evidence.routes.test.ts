// POST/DELETE /mastery-evidence + the D1 completion gate (PATCH /exercises/:id)
// + the D2 airtight delete-guard + the D4 GET /learning-plans/:id evidence embed
// integration tests (M3-03). Every posting/plan/exercise here is fictional
// (RISKS P-01). Laws pinned: an exercise cannot be `complete` without >=1
// implemented AND >=1 tested evidence (the D1 planted-FAIL: 409
// EXERCISE_INCOMPLETE_EVIDENCE); the last implemented/tested evidence of a
// complete exercise cannot be deleted (the D2 planted-FAIL: 409
// EVIDENCE_REQUIRED_FOR_COMPLETION); recordedOn defaults to today and rejects
// the future; the plan embeds each exercise's evidence.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type Exercise, type LearningPlanResponse, type MasteryEvidence } from '@careerforge/core';
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
    email: `evidencer.${seq}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };
  return {
    user,
    headers,
    createExercise: (planId: string, gapIds: string[]) =>
      instance.inject({
        method: 'POST',
        url: '/exercises',
        headers,
        payload: { learningPlanId: planId, title: 'Fictional exercise', kind: 'kata', gapIds },
      }),
    patchExercise: (id: string, status: string) =>
      instance.inject({
        method: 'PATCH',
        url: `/exercises/${id}`,
        headers,
        payload: { status },
      }),
    createEvidence: (payload: unknown, extra: Record<string, string> = {}) =>
      instance.inject({
        method: 'POST',
        url: '/mastery-evidence',
        headers: { ...headers, ...extra },
        payload: payload as Record<string, unknown>,
      }),
    removeEvidence: (id: string) =>
      instance.inject({ method: 'DELETE', url: `/mastery-evidence/${id}`, headers }),
    getPlan: (planId: string) =>
      instance.inject({ method: 'GET', url: `/learning-plans/${planId}`, headers }),
  };
}

type Authed = Awaited<ReturnType<typeof authed>>;

/** Create an exercise via the API and return its id. */
async function makeExercise(user: Authed, planId: string, gapIds: string[]): Promise<string> {
  const res = await user.createExercise(planId, gapIds);
  expect(res.statusCode).toBe(201);
  return res.json<Exercise>().id;
}

/** Record a piece of evidence via the API and return the created row. */
async function addEvidence(
  user: Authed,
  exerciseId: string,
  kind: string,
  extra: Record<string, unknown> = {},
): Promise<MasteryEvidence> {
  const res = await user.createEvidence({ exerciseId, kind, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json<MasteryEvidence>();
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

describe('POST /mastery-evidence', () => {
  it('401s without a session', async () => {
    const instance = await build();
    const anon = await instance.inject({
      method: 'POST',
      url: '/mastery-evidence',
      payload: { exerciseId: '11111111-1111-4111-8111-111111111111', kind: 'implemented' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    const res = await user.createEvidence(
      { exerciseId, kind: 'implemented' },
      { origin: 'https://fictional-evil.example' },
    );
    expect(res.statusCode).toBe(403);
  });

  it('201s and records evidence with an artifact and explicit backdated date', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    const res = await user.createEvidence({
      exerciseId,
      kind: 'implemented',
      artifactUrl: 'https://github.com/alex/repo/pull/9',
      recordedOn: '2020-01-01',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<MasteryEvidence>();
    expect(body.exerciseId).toBe(exerciseId);
    expect(body.kind).toBe('implemented');
    expect(body.artifactUrl).toBe('https://github.com/alex/repo/pull/9');
    // Backdating is allowed — evidence records when work actually happened.
    expect(body.recordedOn).toBe('2020-01-01');
  });

  it('defaults recordedOn to the server today and artifactUrl to null when omitted', async () => {
    const instance = await build({ now: () => new Date('2026-07-20T12:00:00Z') });
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    const res = await user.createEvidence({ exerciseId, kind: 'explained' });
    expect(res.statusCode).toBe(201);
    const body = res.json<MasteryEvidence>();
    expect(body.artifactUrl).toBeNull();
    expect(body.recordedOn).toBe('2026-07-20');
  });

  it('400s a recordedOn in the future (evidence records only what happened)', async () => {
    const instance = await build({ now: () => new Date('2026-07-20T12:00:00Z') });
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    const res = await user.createEvidence({ exerciseId, kind: 'tested', recordedOn: '2026-07-21' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'EVIDENCE_RECORDED_ON_IN_FUTURE',
    );
  });

  it('404s an exercise that is missing or another user’s (value-free)', async () => {
    const instance = await build();
    const user = await authed(instance);
    // Unknown exercise id.
    const missing = await user.createEvidence({
      exerciseId: '99999999-9999-4999-8999-999999999999',
      kind: 'implemented',
    });
    expect(missing.statusCode).toBe(404);

    // Another user's exercise is invisible → 404, not 403.
    const other = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(other.user.id, 1);
    const foreignExercise = await makeExercise(other, planId, gapIds);
    const foreign = await user.createEvidence({ exerciseId: foreignExercise, kind: 'implemented' });
    expect(foreign.statusCode).toBe(404);
  });

  it('400s a malformed body (bad kind, missing exerciseId)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    expect((await user.createEvidence({ exerciseId, kind: 'read' })).statusCode).toBe(400);
    expect((await user.createEvidence({ kind: 'implemented' })).statusCode).toBe(400);
  });
});

describe('DELETE /mastery-evidence/:id', () => {
  it('204s the owner and 404s a foreign/missing row', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    const created = await addEvidence(user, exerciseId, 'implemented');

    // Another user cannot delete it.
    const other = await authed(instance);
    expect((await other.removeEvidence(created.id)).statusCode).toBe(404);
    // The owner can.
    expect((await user.removeEvidence(created.id)).statusCode).toBe(204);
    // Gone now.
    expect((await user.removeEvidence(created.id)).statusCode).toBe(404);
  });
});

describe('D1 completion gate (PATCH /exercises/:id → complete)', () => {
  it('409s completing an exercise with no evidence (EXERCISE_INCOMPLETE_EVIDENCE)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    const res = await user.patchExercise(exerciseId, 'complete');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('EXERCISE_INCOMPLETE_EVIDENCE');
  });

  it('409s with only implemented (tested still missing)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    await addEvidence(user, exerciseId, 'implemented');
    // An explained row does not substitute for tested.
    await addEvidence(user, exerciseId, 'explained');
    expect((await user.patchExercise(exerciseId, 'complete')).statusCode).toBe(409);
  });

  it('200s completing an exercise that HAS implemented + tested (the positive path)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    await addEvidence(user, exerciseId, 'implemented');
    await addEvidence(user, exerciseId, 'tested');
    const res = await user.patchExercise(exerciseId, 'complete');
    expect(res.statusCode).toBe(200);
    expect(res.json<Exercise>().status).toBe('complete');
  });

  it('does not gate non-complete transitions (in_progress with no evidence → 200)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    expect((await user.patchExercise(exerciseId, 'in_progress')).statusCode).toBe(200);
  });

  it('404 (not 409) when completing a foreign/missing exercise (order: 404 before 409)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const missing = await user.patchExercise('99999999-9999-4999-8999-999999999999', 'complete');
    expect(missing.statusCode).toBe(404);
  });
});

describe('D2 airtight delete-guard', () => {
  /** An exercise driven to `complete` with implemented + tested evidence.
   *  Returns the exercise id and the two evidence rows. */
  async function completedExercise(user: Authed) {
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    const implemented = await addEvidence(user, exerciseId, 'implemented');
    const tested = await addEvidence(user, exerciseId, 'tested');
    expect((await user.patchExercise(exerciseId, 'complete')).statusCode).toBe(200);
    return { exerciseId, implemented, tested };
  }

  it('409s deleting the LAST tested evidence of a complete exercise', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { tested } = await completedExercise(user);
    const res = await user.removeEvidence(tested.id);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'EVIDENCE_REQUIRED_FOR_COMPLETION',
    );
  });

  it('204s deleting a NON-LAST implemented row of a complete exercise (does not over-block)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { exerciseId, implemented } = await completedExercise(user);
    // Add a second implemented row, so the first is no longer the last.
    await addEvidence(user, exerciseId, 'implemented');
    expect((await user.removeEvidence(implemented.id)).statusCode).toBe(204);
  });

  it('204s deleting explained/revisited evidence of a complete exercise (not gate kinds)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { exerciseId } = await completedExercise(user);
    const explained = await addEvidence(user, exerciseId, 'explained');
    const revisited = await addEvidence(user, exerciseId, 'revisited');
    expect((await user.removeEvidence(explained.id)).statusCode).toBe(204);
    expect((await user.removeEvidence(revisited.id)).statusCode).toBe(204);
  });

  it('204s deleting the last tested when the exercise is NOT complete (guard only fires on complete)', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    const tested = await addEvidence(user, exerciseId, 'tested');
    // Exercise is still `planned` — deleting its only tested row is fine.
    expect((await user.removeEvidence(tested.id)).statusCode).toBe(204);
  });
});

describe('D4 GET /learning-plans/:id evidence embed', () => {
  it('embeds each exercise’s evidence[] in the plan read', async () => {
    const instance = await build();
    const user = await authed(instance);
    const { planId, gapIds } = await seedPlanWithGaps(user.user.id, 1);
    const exerciseId = await makeExercise(user, planId, gapIds);
    await addEvidence(user, exerciseId, 'implemented', {
      artifactUrl: 'https://github.com/alex/repo/pull/1',
    });
    await addEvidence(user, exerciseId, 'tested');

    const res = await user.getPlan(planId);
    expect(res.statusCode).toBe(200);
    const plan = res.json<LearningPlanResponse>().plan;
    expect(plan).not.toBeNull();
    const exercise = plan!.exercises.find((e) => e.id === exerciseId);
    expect(exercise).toBeDefined();
    expect(exercise!.evidence.map((ev) => ev.kind)).toEqual(['implemented', 'tested']);
    expect(exercise!.evidence[0]!.artifactUrl).toBe('https://github.com/alex/repo/pull/1');
  });
});
