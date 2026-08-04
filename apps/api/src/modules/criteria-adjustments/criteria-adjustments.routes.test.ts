import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  formatStageChangeDetail,
  type ApplicationStage,
  type CriteriaSuggestionsResponse,
  type ConfirmCriteriaAdjustmentResponse,
  type CriteriaAdjustmentsResponse,
} from '@careerforge/core';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import {
  buildTestEnv,
  createSessionRow,
  createTestUser,
  ORIGIN_HEADER,
} from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

// GET /criteria-suggestions, POST + GET /criteria-adjustments (M4-02). The
// server RE-DERIVES the full suggestion list from current state before applying
// (zero client trust — the headline planted-FAIL). Fixtures all fictional
// (RISKS P-01, Alex Rivera).

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

async function buildAt(deps: AppDeps = {}): Promise<FastifyInstance> {
  const instance = await buildApp(env, { dbHandle: handle, ...deps });
  instances.push(instance);
  return instance;
}

type Headers = { cookie: string };

let seq = 0;

async function makeUser(): Promise<{ userId: string; headers: Headers }> {
  seq += 1;
  const user = await createTestUser(handle, {
    email: `outcomes.${seq}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id, new Date('2031-01-01T00:00:00Z'));
  return {
    userId: user.id,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER },
  };
}

// Two removable technologies (min(1) not violated) + two negatives.
const CRITERIA = {
  hardFilters: { employment_type: ['full_time'] },
  positiveSignals: {
    role: ['staff_engineer', 'tech_lead'],
    technologies: ['typescript', 'go'],
    problem_domains: ['developer_tools', 'observability'],
    work_arrangement: ['remote', 'hybrid'],
    scope: ['zero_to_one', 'greenfield'],
  },
  negativeSignals: ['on_call_heavy', 'legacy_php'],
  forceLowestPriority: { industry: ['adtech'] },
  compBounds: { currency: 'usd', base_preferred_min: 180000, base_preferred_max: 240000 },
};

async function seedCriteria(userId: string): Promise<void> {
  await pool.query(
    `insert into search_criteria
       (user_id, hard_filters, positive_signals, negative_signals, force_lowest_priority, comp_bounds)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)`,
    [
      userId,
      JSON.stringify(CRITERIA.hardFilters),
      JSON.stringify(CRITERIA.positiveSignals),
      JSON.stringify(CRITERIA.negativeSignals),
      JSON.stringify(CRITERIA.forceLowestPriority),
      JSON.stringify(CRITERIA.compBounds),
    ],
  );
}

async function seedApp(
  userId: string,
  opts: {
    reqText: string;
    currentStage: ApplicationStage;
    from: ApplicationStage;
    to: ApplicationStage;
  },
): Promise<void> {
  seq += 1;
  const hash = String(seq).padEnd(64, 'a').slice(0, 64);
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
     values ($1, $2, 'anthropic', 'claude', 'extract@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok') returning id`,
    [userId, postingId],
  );
  await pool.query(
    `insert into requirements
       (user_id, extraction_run_id, kind, category, text, source_quote, confidence, position, quote_verified)
     values ($1, $2, 'must_have', 'framework', $3, $3, 0.9, 0, true)`,
    [userId, run.rows[0]!.id, opts.reqText],
  );
  const application = await pool.query<{ id: string }>(
    `insert into applications (user_id, posting_id, stage, applied_on) values ($1, $2, $3, '2026-06-01') returning id`,
    [userId, postingId, opts.currentStage],
  );
  await pool.query(
    `insert into application_events (user_id, application_id, kind, detail, occurred_on)
     values ($1, $2, 'stage_change', $3, '2026-06-01')`,
    [userId, application.rows[0]!.id, formatStageChangeDetail(opts.from, opts.to)],
  );
}

/** Seed the cohort that fires remove_positive_signal(technologies, go): 4 "Go"
 *  postings all rejected before a screen, 4 non-"go" with 2 that progressed. */
async function seedTriggerCohort(userId: string): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await seedApp(userId, {
      reqText: 'Go required',
      currentStage: 'rejected',
      from: 'applied',
      to: 'rejected',
    });
  }
  for (let i = 0; i < 2; i += 1) {
    await seedApp(userId, {
      reqText: 'TypeScript required',
      currentStage: 'screen',
      from: 'applied',
      to: 'screen',
    });
  }
  for (let i = 0; i < 2; i += 1) {
    await seedApp(userId, {
      reqText: 'TypeScript required',
      currentStage: 'rejected',
      from: 'applied',
      to: 'rejected',
    });
  }
}

const SAME_ORIGIN = env.WEB_APP_ORIGIN;

const post = (instance: FastifyInstance, url: string, headers: Headers, payload: unknown) =>
  instance.inject({
    method: 'POST',
    url,
    headers: { ...headers, origin: SAME_ORIGIN },
    payload: payload as Record<string, unknown>,
  });

const getSuggestions = async (instance: FastifyInstance, headers: Headers) => {
  const res = await instance.inject({ method: 'GET', url: '/criteria-suggestions', headers });
  return { status: res.statusCode, body: res.json<CriteriaSuggestionsResponse>() };
};

describe('auth + CSRF', () => {
  it('401s every route unauthenticated', async () => {
    const app = await buildAt();
    expect((await app.inject({ method: 'GET', url: '/criteria-suggestions' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/criteria-adjustments',
          headers: { ...ORIGIN_HEADER },
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/criteria-adjustments' })).statusCode).toBe(
      401,
    );
  });

  it('403s a foreign Origin on the confirm mutator', async () => {
    const app = await buildAt();
    const { headers } = await makeUser();
    const bad = { ...headers, origin: 'https://fictional-evil.example' };
    const res = await app.inject({
      method: 'POST',
      url: '/criteria-adjustments',
      headers: bad,
      payload: {
        kind: 'remove_positive_signal',
        category: 'technologies',
        slug: 'go',
        expectedUpdatedAt: '2026-07-25T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /criteria-suggestions', () => {
  it('returns insufficient_data with disclosed thresholds when below the gate', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    await seedCriteria(userId); // no applications yet
    const { status, body } = await getSuggestions(app, headers);
    expect(status).toBe(200);
    expect(body.status).toBe('insufficient_data');
    expect(body.suggestions).toEqual([]);
    expect(body.thresholds.minResolvedAnalyzable).toBe(8);
    expect(body.criteriaUpdatedAt).not.toBeNull();
  });

  it('returns an ok suggestion with its 2x2 evidence when the cohort triggers', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    await seedCriteria(userId);
    await seedTriggerCohort(userId);
    const { body } = await getSuggestions(app, headers);
    expect(body.status).toBe('ok');
    expect(body.suggestions).toHaveLength(1);
    const [suggestion] = body.suggestions;
    expect(suggestion!.kind).toBe('remove_positive_signal');
    expect(suggestion!.slug).toBe('go');
    expect(suggestion!.evidence.matched).toEqual({ total: 4, progressed: 0 });
    expect(suggestion!.evidence.unmatched).toEqual({ total: 4, progressed: 2 });
    expect(suggestion!.evidence.matchedPostings).toHaveLength(4);
  });
});

describe('POST /criteria-adjustments', () => {
  it('400s a malformed body', async () => {
    const app = await buildAt();
    const { headers } = await makeUser();
    const res = await post(app, '/criteria-adjustments', headers, {
      kind: 'remove_positive_signal',
      // missing category + slug + expectedUpdatedAt
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s CRITERIA_NOT_FOUND before any 409 when the user has no criteria', async () => {
    const app = await buildAt();
    const { headers } = await makeUser(); // no criteria seeded
    const res = await post(app, '/criteria-adjustments', headers, {
      kind: 'remove_positive_signal',
      category: 'technologies',
      slug: 'go',
      expectedUpdatedAt: '2026-07-25T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CRITERIA_NOT_FOUND');
  });

  it('409s SUGGESTION_NOT_DERIVABLE for a tampered triple the server will not derive', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    await seedCriteria(userId);
    await seedTriggerCohort(userId);
    const { body } = await getSuggestions(app, headers);
    // 'typescript' IS in criteria but does NOT fire (its matched cell progressed).
    const res = await post(app, '/criteria-adjustments', headers, {
      kind: 'remove_positive_signal',
      category: 'technologies',
      slug: 'typescript',
      expectedUpdatedAt: body.criteriaUpdatedAt,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('SUGGESTION_NOT_DERIVABLE');
  });

  it('409s STALE_CRITERIA when the pin no longer matches', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    await seedCriteria(userId);
    await seedTriggerCohort(userId);
    const { body } = await getSuggestions(app, headers);
    // Someone bumps the criteria; the pin the client holds is now stale.
    await pool.query(
      `update search_criteria set updated_at = now() + interval '1 second' where user_id = $1`,
      [userId],
    );
    const res = await post(app, '/criteria-adjustments', headers, {
      kind: 'remove_positive_signal',
      category: 'technologies',
      slug: 'go',
      expectedUpdatedAt: body.criteriaUpdatedAt,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('STALE_CRITERIA');
  });

  it('201s the happy path: audit row written, criteria changed, pin advanced, suggestion vanishes', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    await seedCriteria(userId);
    await seedTriggerCohort(userId);
    const { body } = await getSuggestions(app, headers);
    const pin = body.criteriaUpdatedAt;

    const res = await post(app, '/criteria-adjustments', headers, {
      kind: 'remove_positive_signal',
      category: 'technologies',
      slug: 'go',
      expectedUpdatedAt: pin,
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<ConfirmCriteriaAdjustmentResponse>();
    expect(created.adjustment.slug).toBe('go');
    expect(created.adjustment.evidence.matched.progressed).toBe(0);
    // Criteria actually changed: 'go' removed from technologies.
    expect(created.criteria.positiveSignals.technologies).toEqual(['typescript']);
    // The pin advanced past the caller's view.
    expect(new Date(created.criteria.updatedAt).getTime()).toBeGreaterThan(
      new Date(pin!).getTime(),
    );

    // The audit list now carries exactly the confirmed adjustment.
    const audit = await app.inject({ method: 'GET', url: '/criteria-adjustments', headers });
    const auditBody = audit.json<CriteriaAdjustmentsResponse>();
    expect(auditBody.adjustments).toHaveLength(1);
    expect(auditBody.adjustments[0]!.slug).toBe('go');

    // Re-deriving: the suggestion is gone (the slug left the criteria).
    const after = await getSuggestions(app, headers);
    expect(after.body.suggestions.find((s) => s.slug === 'go')).toBeUndefined();
  });
});

describe('GET /criteria-adjustments', () => {
  it('returns an empty audit list for a fresh user', async () => {
    const app = await buildAt();
    const { headers } = await makeUser();
    const res = await app.inject({ method: 'GET', url: '/criteria-adjustments', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json<CriteriaAdjustmentsResponse>().adjustments).toEqual([]);
  });
});
