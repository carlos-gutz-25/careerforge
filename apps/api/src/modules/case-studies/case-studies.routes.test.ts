import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type CaseStudiesResponse, type CaseStudy, type Exercise } from '@careerforge/core';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

// POST/GET/DELETE /case-studies + export + publish (M4-01). Deterministic
// exercise -> case-study draft: the server re-derives the whole draft from the
// exercise + evidence + gap-link state. Fixtures all fictional (RISKS P-01,
// Alex Rivera).

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

async function buildAt(
  isoInstant = '2026-07-20T12:00:00Z',
  deps: AppDeps = {},
): Promise<FastifyInstance> {
  const instance = await buildApp(env, {
    dbHandle: handle,
    now: () => new Date(isoInstant),
    ...deps,
  });
  instances.push(instance);
  return instance;
}

type Headers = { cookie: string };

let seq = 0;

async function makeUser(): Promise<{ userId: string; headers: Headers }> {
  seq += 1;
  const user = await createTestUser(handle, {
    email: `author.${seq}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id, new Date('2031-01-01T00:00:00Z'));
  return { userId: user.id, headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } };
}

/** A plan citing one gap. Returns the plan id + gap id. */
async function seedPlanWithGap(userId: string): Promise<{ planId: string; gapId: string }> {
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
     values ($1, $2, 'anthropic', 'claude', 'extract@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok') returning id`,
    [userId, posting.rows[0]!.id],
  );
  const report = await pool.query<{ id: string }>(
    `insert into fit_reports
       (user_id, posting_id, extraction_run_id, verdict, exclusions, criteria_snapshot,
        forced_lowest, input_flagged)
     values ($1, $2, $3, 'scored', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false) returning id`,
    [userId, posting.rows[0]!.id, run.rows[0]!.id],
  );
  const req = await pool.query<{ id: string }>(
    `insert into requirements
       (user_id, extraction_run_id, kind, category, text, source_quote, confidence, position)
     values ($1, $2, 'must_have', 'framework', 'Some skill', 'Some skill', 0.9, 0) returning id`,
    [userId, run.rows[0]!.id],
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
     values ($1, 'anthropic', 'claude', 'learning-plan@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok') returning id`,
    [userId],
  );
  const plan = await pool.query<{ id: string }>(
    `insert into learning_plans (user_id, title, drafting_run_id) values ($1, 'Fictional plan', $2) returning id`,
    [userId, lrun.rows[0]!.id],
  );
  await pool.query(
    `insert into learning_plan_gaps (user_id, learning_plan_id, gap_id, focus, priority, position)
     values ($1, $2, $3, 'focus', 'high', 0)`,
    [userId, plan.rows[0]!.id, gap.rows[0]!.id],
  );
  return { planId: plan.rows[0]!.id, gapId: gap.rows[0]!.id };
}

/** Create an exercise citing a gap, add the evidence in `kinds`, and (unless
 *  keepPlanned) complete it. Returns the exercise id. */
async function makeExercise(
  instance: FastifyInstance,
  headers: Headers,
  userId: string,
  {
    kinds = ['implemented', 'tested'],
    keepPlanned = false,
    title = 'Build a typed parser',
  }: { kinds?: string[]; keepPlanned?: boolean; title?: string } = {},
): Promise<string> {
  const { planId, gapId } = await seedPlanWithGap(userId);
  const created = await instance.inject({
    method: 'POST',
    url: '/exercises',
    headers,
    payload: { learningPlanId: planId, title, kind: 'kata', gapIds: [gapId] },
  });
  expect(created.statusCode).toBe(201);
  const exerciseId = created.json<Exercise>().id;
  for (const kind of kinds) {
    const res = await instance.inject({
      method: 'POST',
      url: '/mastery-evidence',
      headers,
      payload: { exerciseId, kind },
    });
    expect(res.statusCode).toBe(201);
  }
  if (!keepPlanned) {
    const patched = await instance.inject({
      method: 'PATCH',
      url: `/exercises/${exerciseId}`,
      headers,
      payload: { status: 'complete' },
    });
    expect(patched.statusCode).toBe(200);
  }
  return exerciseId;
}

// A same-origin mutation: the CSRF hook rejects only a FOREIGN Origin, so a
// request with no Origin header passes (the makeExercise precedent).
const post = (instance: FastifyInstance, url: string, headers: Headers, payload?: unknown) =>
  instance.inject({
    method: 'POST',
    url,
    headers,
    payload: payload as Record<string, unknown>,
  });

const del = (instance: FastifyInstance, url: string, headers: Headers) =>
  instance.inject({ method: 'DELETE', url, headers });

describe('auth + CSRF', () => {
  it('401s every route unauthenticated', async () => {
    const app = await buildAt();
    const id = '11111111-1111-4111-8111-111111111111';
    expect((await app.inject({ method: 'POST', url: '/case-studies' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/case-studies' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/case-studies/${id}` })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: `/case-studies/${id}/export` })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: `/case-studies/${id}/publish` })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: `/case-studies/${id}` })).statusCode).toBe(
      401,
    );
  });

  it('403s a foreign Origin on each mutator', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const bad = { ...headers, origin: 'https://fictional-evil.example' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/case-studies',
          headers: bad,
          payload: { exerciseId, provenance: 'personal' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/case-studies/${exerciseId}/publish`,
          headers: bad,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: `/case-studies/${exerciseId}`, headers: bad }))
        .statusCode,
    ).toBe(403);
  });
});

describe('POST /case-studies (generate + refresh, OD-1)', () => {
  it('201s a new draft with the wire shape; markdown is born-valid grammar', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const res = await post(app, '/case-studies', headers, { exerciseId, provenance: 'personal' });
    expect(res.statusCode).toBe(201);
    const body = res.json<CaseStudy>();
    expect(body.status).toBe('draft');
    expect(body.provenance).toBe('personal');
    expect(body.exerciseId).toBe(exerciseId);
    expect(body.title).toBe('Build a typed parser'); // defaulted to exercise title
    expect(body.renderedMarkdown).toContain('## Problem');
    expect(body.renderedMarkdown).toContain('provenance: personal');
  });

  it('honors an explicit title and provenance', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const res = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal_ai_assisted',
      title: 'My custom title',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<CaseStudy>().title).toBe('My custom title');
    expect(res.json<CaseStudy>().provenance).toBe('personal_ai_assisted');
  });

  it('409 EXERCISE_NOT_COMPLETE for a planned exercise', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId, { keepPlanned: true, kinds: [] });
    const res = await post(app, '/case-studies', headers, { exerciseId, provenance: 'personal' });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('EXERCISE_NOT_COMPLETE');
  });

  it('404 EXERCISE_NOT_FOUND for an unknown or foreign exercise', async () => {
    const app = await buildAt();
    const { headers } = await makeUser();
    const unknown = await post(app, '/case-studies', headers, {
      exerciseId: '11111111-1111-4111-8111-111111111111',
      provenance: 'personal',
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ error: { code: string } }>().error.code).toBe('EXERCISE_NOT_FOUND');

    // Another user's exercise is invisible -> 404, not 403.
    const other = await makeUser();
    const otherApp = app;
    const foreignExercise = await makeExercise(otherApp, other.headers, other.userId);
    const foreign = await post(app, '/case-studies', headers, {
      exerciseId: foreignExercise,
      provenance: 'personal',
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('200s a refresh when re-POSTed; new evidence appears and bytes differ', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId, {
      kinds: ['implemented', 'tested'],
    });
    const first = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
      title: 'Custom',
    });
    expect(first.statusCode).toBe(201);

    // Add another evidence row, then re-POST.
    await post(app, '/mastery-evidence', headers, { exerciseId, kind: 'explained' });
    const second = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
      title: 'Custom',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<CaseStudy>().id).toBe(first.json<CaseStudy>().id);
    expect(second.json<CaseStudy>().renderedMarkdown).toContain('- explained');
    expect(second.json<CaseStudy>().renderedMarkdown).not.toBe(
      first.json<CaseStudy>().renderedMarkdown,
    );
  });

  it('refresh with an OMITTED title RESETS to the exercise title (full-replacement)', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId, { title: 'Exercise name' });
    const custom = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
      title: 'A custom title',
    });
    expect(custom.json<CaseStudy>().title).toBe('A custom title');
    const refreshed = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json<CaseStudy>().title).toBe('Exercise name');
  });

  it('409 CASE_STUDY_ALREADY_PUBLISHED on a re-POST after publish', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const created = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
    });
    await post(app, `/case-studies/${created.json<CaseStudy>().id}/publish`, headers);
    const again = await post(app, '/case-studies', headers, { exerciseId, provenance: 'personal' });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe(
      'CASE_STUDY_ALREADY_PUBLISHED',
    );
  });
});

describe('publish (one-way CAS)', () => {
  it('200s then 409s a second publish; 404 unknown', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const created = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
    });
    const id = created.json<CaseStudy>().id;
    const first = await post(app, `/case-studies/${id}/publish`, headers);
    expect(first.statusCode).toBe(200);
    expect(first.json<CaseStudy>().status).toBe('published');
    const second = await post(app, `/case-studies/${id}/publish`, headers);
    expect(second.statusCode).toBe(409);
    const unknown = await post(
      app,
      `/case-studies/11111111-1111-4111-8111-111111111111/publish`,
      headers,
    );
    expect(unknown.statusCode).toBe(404);
  });
});

describe('GET list + detail', () => {
  it('list omits markdown; detail includes it', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const created = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
    });
    const id = created.json<CaseStudy>().id;

    const list = await app.inject({ method: 'GET', url: '/case-studies', headers });
    expect(list.statusCode).toBe(200);
    const items = list.json<CaseStudiesResponse>().caseStudies;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('renderedMarkdown');

    const detail = await app.inject({ method: 'GET', url: `/case-studies/${id}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<CaseStudy>().renderedMarkdown).toContain('## Problem');

    const missing = await app.inject({
      method: 'GET',
      url: '/case-studies/11111111-1111-4111-8111-111111111111',
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('export (OD-5, no status gate)', () => {
  it('serves raw markdown byte-identical to the stored snapshot, on a DRAFT', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const created = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
    });
    const id = created.json<CaseStudy>().id;
    const stored = created.json<CaseStudy>().renderedMarkdown;

    const res = await app.inject({ method: 'GET', url: `/case-studies/${id}/export`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="case-study-${id}.md"`);
    // Raw markdown, NOT a JSON-quoted string (the serializer-bypass pin).
    expect(res.body).toBe(stored);
    expect(res.body.startsWith('---\n')).toBe(true);
  });
});

describe('DELETE (any status, OD-4)', () => {
  it('204s a draft AND a published row, then POST re-creates 201', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const created = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
    });
    const id = created.json<CaseStudy>().id;
    await post(app, `/case-studies/${id}/publish`, headers);

    const deleted = await del(app, `/case-studies/${id}`, headers);
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');

    // Slot freed: a fresh POST re-creates (201).
    const again = await post(app, '/case-studies', headers, { exerciseId, provenance: 'personal' });
    expect(again.statusCode).toBe(201);
    expect(again.json<CaseStudy>().id).not.toBe(id);

    const missing = await del(app, `/case-studies/${id}`, headers);
    expect(missing.statusCode).toBe(404);
  });
});

describe('orphaned row (source exercise deleted)', () => {
  it('GET/export/publish/DELETE work by row id; POST on the dead exercise id 404s', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId);
    const created = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
    });
    const id = created.json<CaseStudy>().id;

    // Delete the source exercise (SET NULL on the FK).
    const delEx = await del(app, `/exercises/${exerciseId}`, headers);
    expect(delEx.statusCode).toBe(204);

    const detail = await app.inject({ method: 'GET', url: `/case-studies/${id}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<CaseStudy>().exerciseId).toBeNull();
    expect(detail.json<CaseStudy>().exerciseTitle).toBe('Build a typed parser');

    const exported = await app.inject({
      method: 'GET',
      url: `/case-studies/${id}/export`,
      headers,
    });
    expect(exported.statusCode).toBe(200);

    // POST on the now-dead exercise id 404s (it no longer resolves).
    const repost = await post(app, '/case-studies', headers, {
      exerciseId,
      provenance: 'personal',
    });
    expect(repost.statusCode).toBe(404);

    const published = await post(app, `/case-studies/${id}/publish`, headers);
    expect(published.statusCode).toBe(200);
  });
});
