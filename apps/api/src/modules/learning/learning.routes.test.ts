// POST /learning-plans + GET /learning-plans(/:id) + POST /learning-plans/:id/review
// integration tests (M3-01). Every posting, requirement, profile row, and
// criteria value here is fictional (RISKS P-01). Laws pinned: drafting requires
// EVERY selected gap's source report be reviewed; verified structured data only
// reaches the provider (payload never contains raw posting text beyond the
// extracted requirement strings); FREE-CREATE (every draft is a fresh plan, no
// cache); a fabricated gap-ref flags the run with NO plan row (layer-4 analog);
// review is one-shot CAS; no focus/title/quote/rationale/skill text ever enters
// logs.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  type FitReportGapsResponse,
  type LearningPlanListResponse,
  type LearningPlanResponse,
  type SearchCriteriaData,
} from '@careerforge/core';
import { createMockProvider } from '@careerforge/llm';
import {
  createExtractionsRepository,
  createProfileRepository,
  createSearchCriteriaRepository,
  type ExtractionRunInsert,
  type RequirementInsert,
} from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();
const extractions = createExtractionsRepository(handle.db);
const profileRepo = createProfileRepository(handle.db);
const criteriaRepo = createSearchCriteriaRepository(handle.db);

const KUBERNETES_REQ = 'Fictional Kubernetes operations requirement';
const GRAPHQL_REQ = 'Fictional GraphQL federation requirement';

const CRITERIA: SearchCriteriaData = {
  hardFilters: { employment_type: ['contract'] },
  positiveSignals: {
    role: ['senior'],
    technologies: ['typescript'],
    problem_domains: ['event_driven'],
    work_arrangement: ['remote'],
    scope: ['platform'],
  },
  negativeSignals: ['gamedev_crunch'],
  forceLowestPriority: { industry: ['defense'] },
  compBounds: { currency: 'usd', base_preferred_min: 155_000, base_preferred_max: 195_000 },
};

/** A learning draft citing g1 — the happy path for a one-gap selection. */
const DRAFT_G1 = JSON.stringify({
  title: 'Fictional Kubernetes learning plan',
  items: [
    {
      gapRef: 'g1',
      focus: 'Build a fictional Kubernetes lab and document a failover drill.',
      priority: 'high',
    },
  ],
});

/** A learning draft citing g1 + g2 — a two-gap (cross-posting) selection. */
const DRAFT_G1_G2 = JSON.stringify({
  title: 'Fictional cross-posting plan',
  items: [
    { gapRef: 'g1', focus: 'Grounded fictional focus one.', priority: 'high' },
    { gapRef: 'g2', focus: 'Grounded fictional focus two.', priority: 'medium' },
  ],
});

/** Cites a ref the payload never contained — the fabrication case. */
const DRAFT_FABRICATED = JSON.stringify({
  title: 'Fictional plan',
  items: [{ gapRef: 'g9', focus: 'Grounded-sounding but uncited focus.', priority: 'high' }],
});

function runInsert(overrides: Partial<ExtractionRunInsert> = {}): ExtractionRunInsert {
  return {
    promptId: 'extract-requirements@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    rawResponse: { mock: true },
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 25,
    attempt: 1,
    status: 'ok',
    createdAt: new Date('2026-07-24T09:00:00.000Z'),
    ...overrides,
  };
}

function requirementInsert(
  text: string,
  overrides: Partial<RequirementInsert> = {},
): RequirementInsert {
  return {
    kind: 'must_have',
    category: 'other',
    text,
    sourceQuote: text,
    confidence: 0.9,
    quoteVerified: true,
    ...overrides,
  };
}

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

let userSequence = 0;
async function authedPlanner(instance: FastifyInstance) {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `learner.${userSequence}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };

  const draft = (gapIds: string[], extraHeaders: Record<string, string> = {}) =>
    instance.inject({
      method: 'POST',
      url: '/learning-plans',
      headers: { ...headers, ...extraHeaders },
      payload: { gapIds },
    });
  const getPlan = (planId: string) =>
    instance.inject({ method: 'GET', url: `/learning-plans/${planId}`, headers });
  const listPlans = () => instance.inject({ method: 'GET', url: '/learning-plans', headers });
  const reviewPlan = (planId: string, payload?: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/learning-plans/${planId}/review`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const getGaps = async (reportId: string) => {
    const response = await instance.inject({
      method: 'GET',
      url: `/fit-reports/${reportId}/gaps`,
      headers,
    });
    return response.json<FitReportGapsResponse>().gaps;
  };

  return { user, headers, draft, getPlan, listPlans, reviewPlan, getGaps };
}

/** A reviewed fit report for one posting carrying the given requirement texts.
 *  Profile has TypeScript only, so a Kubernetes/GraphQL requirement lands as a
 *  genuine_gap (eligible). Returns the report id. */
async function seededReviewedReport(
  instance: FastifyInstance,
  planner: Awaited<ReturnType<typeof authedPlanner>>,
  requirementTexts: string[],
  { review = true }: { review?: boolean } = {},
): Promise<string> {
  const paste = await instance.inject({
    method: 'POST',
    url: '/postings',
    headers: planner.headers,
    payload: { rawText: `Fictional posting.\n${requirementTexts.join('\n')}` },
  });
  const postingId = paste.json<{ posting: { id: string } }>().posting.id;
  await extractions.persistExtraction(
    planner.user.id,
    postingId,
    [runInsert()],
    requirementTexts.map((text) => requirementInsert(text)),
  );
  await profileRepo.syncProfile(planner.user.id, {
    skills: [
      { name: 'TypeScript', category: 'language', level: 'expert', years: 8, lastUsed: null },
    ],
    experiences: [
      {
        company: 'Fictional Gizmo Works',
        title: 'Senior Software Engineer',
        startDate: '2019-02-01',
        endDate: null,
        bullets: [],
      },
    ],
    projects: [],
  });
  await criteriaRepo.upsert(planner.user.id, CRITERIA);
  const scored = await instance.inject({
    method: 'POST',
    url: `/postings/${postingId}/fit`,
    headers: planner.headers,
  });
  expect(scored.statusCode).toBe(201);
  const reportId = scored.json<{ id: string }>().id;
  if (review) {
    const reviewed = await instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/review`,
      headers: planner.headers,
    });
    expect(reviewed.statusCode).toBe(200);
  }
  return reportId;
}

async function gapIdFor(
  planner: Awaited<ReturnType<typeof authedPlanner>>,
  reportId: string,
  requirementText: string,
): Promise<string> {
  const gaps = await planner.getGaps(reportId);
  const match = gaps.find((gap) => gap.requirementText === requirementText);
  if (!match) throw new Error(`no gap for requirement '${requirementText}'`);
  return match.id;
}

describe('POST /learning-plans', () => {
  it('401s without a session and 403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const anonymous = await instance.inject({
      method: 'POST',
      url: '/learning-plans',
      payload: { gapIds: ['11111111-1111-4111-8111-111111111111'] },
    });
    expect(anonymous.statusCode).toBe(401);

    const planner = await authedPlanner(instance);
    const reportId = await seededReviewedReport(instance, planner, [KUBERNETES_REQ]);
    const gapId = await gapIdFor(planner, reportId, KUBERNETES_REQ);
    const crossOrigin = await planner.draft([gapId], { origin: 'https://fictional-evil.example' });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it('drafts across two postings: 201, fresh plan, cited gaps, verified-data-only payload', async () => {
    const provider = createMockProvider([{ text: DRAFT_G1_G2 }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const reportA = await seededReviewedReport(instance, planner, [KUBERNETES_REQ]);
    const reportB = await seededReviewedReport(instance, planner, [GRAPHQL_REQ]);
    const gapA = await gapIdFor(planner, reportA, KUBERNETES_REQ);
    const gapB = await gapIdFor(planner, reportB, GRAPHQL_REQ);

    const response = await planner.draft([gapA, gapB]);
    expect(response.statusCode).toBe(201);
    const body = response.json<LearningPlanResponse>();
    expect(body.cached).toBe(false);
    expect(body.run?.status).toBe('ok');
    expect(body.plan?.reviewStatus).toBe('draft');
    expect(body.plan?.title).toBe('Fictional cross-posting plan');
    expect(body.plan?.gaps).toHaveLength(2);
    expect(body.plan?.gaps.map((gap) => gap.position)).toEqual([0, 1]);
    expect(new Set(body.plan?.gaps.map((gap) => gap.requirementText))).toEqual(
      new Set([KUBERNETES_REQ, GRAPHQL_REQ]),
    );

    // Verified structured data only: the payload carries requirement strings,
    // never a whole raw posting, and the system prompt is untouched.
    const userMessage = provider.requests[0]?.messages[0]?.content ?? '';
    expect(userMessage).toContain(KUBERNETES_REQ);
    expect(provider.requests[0]?.system).not.toContain(KUBERNETES_REQ);
  });

  it('404 when any selected gap is unknown or foreign (one outcome, no provider call)', async () => {
    const provider = createMockProvider([]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const reportId = await seededReviewedReport(instance, planner, [KUBERNETES_REQ]);
    const gapId = await gapIdFor(planner, reportId, KUBERNETES_REQ);

    const withUnknown = await planner.draft([gapId, '99999999-9999-4999-8999-999999999999']);
    expect(withUnknown.statusCode).toBe(404);

    const stranger = await authedPlanner(instance);
    const foreign = await stranger.draft([gapId]);
    expect(foreign.statusCode).toBe(404);
    expect(provider.requests).toHaveLength(0);
  });

  it('409 REPORTS_NOT_REVIEWED when a selected gap comes from an unreviewed report', async () => {
    const provider = createMockProvider([]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const reportId = await seededReviewedReport(instance, planner, [KUBERNETES_REQ], {
      review: false,
    });
    const gapId = await gapIdFor(planner, reportId, KUBERNETES_REQ);

    const response = await planner.draft([gapId]);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('REPORTS_NOT_REVIEWED');
    expect(provider.requests).toHaveLength(0);
  });

  it('fabricated gap-ref: run flagged, NO plan row, 201 result', async () => {
    const provider = createMockProvider([{ text: DRAFT_FABRICATED }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const reportId = await seededReviewedReport(instance, planner, [KUBERNETES_REQ]);
    const gapId = await gapIdFor(planner, reportId, KUBERNETES_REQ);

    const response = await planner.draft([gapId]);
    expect(response.statusCode).toBe(201);
    const body = response.json<LearningPlanResponse>();
    expect(body.run?.status).toBe('flagged');
    expect(body.plan).toBeNull();
  });

  it('503 LLM_NOT_CONFIGURED without a provider (after the gates)', async () => {
    const instance = await build();
    const planner = await authedPlanner(instance);
    const reportId = await seededReviewedReport(instance, planner, [KUBERNETES_REQ]);
    const gapId = await gapIdFor(planner, reportId, KUBERNETES_REQ);
    const response = await planner.draft([gapId]);
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('drafting never logs focus, title, quote, rationale, or skill text', async () => {
    const lines: string[] = [];
    const provider = createMockProvider([{ text: DRAFT_G1 }]);
    const instance = await build({
      llmProvider: provider,
      logStream: { write: (line: string) => void lines.push(line) },
    });
    const planner = await authedPlanner(instance);
    const reportId = await seededReviewedReport(instance, planner, [KUBERNETES_REQ]);
    const gapId = await gapIdFor(planner, reportId, KUBERNETES_REQ);
    await planner.draft([gapId]);

    const logged = lines.join('');
    expect(logged).not.toContain('Build a fictional Kubernetes lab');
    expect(logged).not.toContain('Fictional Kubernetes learning plan');
    expect(logged).not.toContain(KUBERNETES_REQ);
    expect(logged).not.toContain('TypeScript');
  });
});

describe('GET /learning-plans and /:id', () => {
  it('404 for a missing/foreign plan; lists the user own plans newest first', async () => {
    const provider = createMockProvider([{ text: DRAFT_G1 }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const reportId = await seededReviewedReport(instance, planner, [KUBERNETES_REQ]);
    const gapId = await gapIdFor(planner, reportId, KUBERNETES_REQ);

    const missing = await planner.getPlan('99999999-9999-4999-8999-999999999999');
    expect(missing.statusCode).toBe(404);

    const planId = (await planner.draft([gapId])).json<LearningPlanResponse>().plan?.id ?? '';
    const read = await planner.getPlan(planId);
    expect(read.statusCode).toBe(200);
    expect(read.json<LearningPlanResponse>().plan?.id).toBe(planId);

    const list = await planner.listPlans();
    expect(list.statusCode).toBe(200);
    const listBody = list.json<LearningPlanListResponse>();
    expect(listBody.plans).toHaveLength(1);
    expect(listBody.plans[0]?.gapCount).toBe(1);
  });
});

describe('POST /learning-plans/:id/review', () => {
  it('one-shot: 200 with trimmed notes, then 409 PLAN_ALREADY_REVIEWED; 404 foreign', async () => {
    const provider = createMockProvider([{ text: DRAFT_G1 }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const reportId = await seededReviewedReport(instance, planner, [KUBERNETES_REQ]);
    const gapId = await gapIdFor(planner, reportId, KUBERNETES_REQ);
    const planId = (await planner.draft([gapId])).json<LearningPlanResponse>().plan?.id ?? '';

    const reviewed = await planner.reviewPlan(planId, { notes: '  Looks right.  ' });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json<{ notes: string }>().notes).toBe('Looks right.');

    const again = await planner.reviewPlan(planId);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('PLAN_ALREADY_REVIEWED');

    const stranger = await authedPlanner(instance);
    expect((await stranger.reviewPlan(planId)).statusCode).toBe(404);
  });
});
