// POST/GET /fit-reports/:id/improvement-plan + POST /improvement-plans/:id/review
// + PATCH /plan-items/:id integration tests (M1-12). Every posting,
// requirement, profile row, and criteria value here is fictional (RISKS
// P-01). Laws pinned: drafting requires a REVIEWED report; verified
// structured data only reaches the provider (payload never contains raw
// posting text beyond the extracted requirement strings); one plan per
// report (200-existing, no force); non-ok terminals are 201 results; a
// fabricated gap-ref flags the run with NO plan row (layer-4 analog); R2 run
// selection; review is one-shot CAS; item PATCH is full-replacement of the
// two mutable fields; no action/quote/rationale/skill text ever enters logs.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type FitReportPlanResponse, type SearchCriteriaData } from '@careerforge/core';
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

const FICTIONAL_POSTING = [
  'Senior TypeScript Engineer — Fictional Gadget Labs.',
  'Requirements: 5+ years TypeScript experience. Kubernetes operations.',
].join('\n');

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

/** One item citing g1 — the drafting mock's happy path. */
const VALID_DRAFT = JSON.stringify({
  items: [
    { gapRef: 'g1', action: 'Publish a fictional Kubernetes lab writeup.', priority: 'high' },
    { gapRef: 'g1', action: 'Run a fictional failover drill and document it.', priority: 'medium' },
  ],
});

/** Cites a ref the payload never contained — the fabrication case. */
const FABRICATED_DRAFT = JSON.stringify({
  items: [{ gapRef: 'g9', action: 'Grounded-sounding but uncited action.', priority: 'high' }],
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
    createdAt: new Date('2026-07-19T09:00:00.000Z'),
    ...overrides,
  };
}

function requirementInsert(overrides: Partial<RequirementInsert> = {}): RequirementInsert {
  return {
    kind: 'must_have',
    category: 'other',
    text: 'Fictional Kubernetes operations requirement',
    sourceQuote: 'Kubernetes operations.',
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
    email: `planner.${userSequence}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };

  const paste = async (rawText: string) => {
    const response = await instance.inject({
      method: 'POST',
      url: '/postings',
      headers,
      payload: { rawText },
    });
    return response.json<{ posting: { id: string } }>().posting.id;
  };
  const draft = (reportId: string, extraHeaders: Record<string, string> = {}) =>
    instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/improvement-plan`,
      headers: { ...headers, ...extraHeaders },
    });
  const getPlan = (reportId: string) =>
    instance.inject({
      method: 'GET',
      url: `/fit-reports/${reportId}/improvement-plan`,
      headers,
    });
  const reviewPlan = (planId: string, payload?: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/improvement-plans/${planId}/review`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const patchItem = (itemId: string, payload: Record<string, unknown>) =>
    instance.inject({ method: 'PATCH', url: `/plan-items/${itemId}`, headers, payload });

  return { user, headers, paste, draft, getPlan, reviewPlan, patchItem };
}

/** Full fictional chain: posting → seeded ok extraction → profile+criteria →
 *  scored fit report → REVIEWED (the drafting gate). Returns the report id. */
async function seededReviewedReport(
  instance: FastifyInstance,
  planner: Awaited<ReturnType<typeof authedPlanner>>,
  { review = true }: { review?: boolean } = {},
) {
  const postingId = await planner.paste(FICTIONAL_POSTING);
  await extractions.persistExtraction(
    planner.user.id,
    postingId,
    [runInsert()],
    [requirementInsert()],
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
  return { postingId, reportId };
}

describe('POST /fit-reports/:id/improvement-plan', () => {
  it('401s without a session and 403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const anonymous = await instance.inject({
      method: 'POST',
      url: '/fit-reports/11111111-1111-4111-8111-111111111111/improvement-plan',
    });
    expect(anonymous.statusCode).toBe(401);

    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);
    const crossOrigin = await planner.draft(reportId, {
      origin: 'https://fictional-evil.example',
    });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it('drafts from a reviewed report: 201, plan + items in model order, R2 run under the plan', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);

    const response = await planner.draft(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportPlanResponse>();
    expect(body.cached).toBe(false);
    expect(body.run?.status).toBe('ok');
    expect(body.plan?.reviewStatus).toBe('draft');
    expect(body.plan?.fitReportId).toBe(reportId);
    expect(body.plan?.items.map((item) => item.position)).toEqual([0, 1]);
    expect(body.plan?.items[0]?.status).toBe('planned');
    expect(body.plan?.items[0]?.requirementText).toBe(
      'Fictional Kubernetes operations requirement',
    );
    // The run under a fresh plan is the drafting run itself (R2).
    expect(body.plan && body.run && body.run.id).toBeTruthy();

    // The provider saw verified structured data only: the payload carries the
    // requirement/evidence strings, NEVER the whole raw posting text.
    const request = provider.requests[0];
    const userMessage = request?.messages[0]?.content ?? '';
    expect(userMessage).toContain('Fictional Kubernetes operations requirement');
    expect(userMessage).not.toContain(FICTIONAL_POSTING);
    expect(request?.system).not.toContain('Fictional Kubernetes operations requirement');
  });

  it('409 REPORT_NOT_REVIEWED on a draft report; 404 one-outcome for missing and foreign', async () => {
    const provider = createMockProvider([]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner, { review: false });

    const unreviewed = await planner.draft(reportId);
    expect(unreviewed.statusCode).toBe(409);
    expect(unreviewed.json<{ error: { code: string } }>().error.code).toBe('REPORT_NOT_REVIEWED');

    const missing = await planner.draft('99999999-9999-4999-8999-999999999999');
    expect(missing.statusCode).toBe(404);

    const stranger = await authedPlanner(instance);
    const foreign = await stranger.draft(reportId);
    expect(foreign.statusCode).toBe(404);
    // No provider call was ever placed (script exhaustion would have thrown).
    expect(provider.requests).toHaveLength(0);
  });

  it('200-existing on the second POST (UNIQUE as cache): one wire call total', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);

    const first = await planner.draft(reportId);
    expect(first.statusCode).toBe(201);
    const second = await planner.draft(reportId);
    expect(second.statusCode).toBe(200);
    const body = second.json<FitReportPlanResponse>();
    expect(body.cached).toBe(true);
    expect(body.plan?.id).toBe(first.json<FitReportPlanResponse>().plan?.id);
    expect(provider.requests).toHaveLength(1);
  });

  it('fabricated gap-ref: run flagged, NO plan row, 201 result; GET serves the flagged run', async () => {
    const provider = createMockProvider([{ text: FABRICATED_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);

    const response = await planner.draft(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportPlanResponse>();
    expect(body.run?.status).toBe('flagged');
    expect(body.plan).toBeNull();

    const read = await planner.getPlan(reportId);
    expect(read.statusCode).toBe(200);
    const readBody = read.json<FitReportPlanResponse>();
    expect(readBody.plan).toBeNull();
    expect(readBody.run?.status).toBe('flagged');
  });

  it('schema failure retries once then 201 schema_failed (two audit rows, no plan)', async () => {
    const provider = createMockProvider([{ text: 'not json' }, { text: 'still not json' }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);

    const response = await planner.draft(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportPlanResponse>();
    expect(body.run?.status).toBe('schema_failed');
    expect(body.run?.attempt).toBe(2);
    expect(body.plan).toBeNull();
    expect(provider.requests).toHaveLength(2);
  });

  it('503 LLM_NOT_CONFIGURED without a provider (after the 409 gates)', async () => {
    const instance = await build();
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);
    const response = await planner.draft(reportId);
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('drafting never logs action, quote, rationale, or skill text', async () => {
    const lines: string[] = [];
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({
      llmProvider: provider,
      logStream: { write: (line: string) => void lines.push(line) },
    });
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);
    await planner.draft(reportId);

    const logged = lines.join('');
    expect(logged).not.toContain('Publish a fictional Kubernetes lab writeup');
    expect(logged).not.toContain('Fictional Kubernetes operations requirement');
    expect(logged).not.toContain('Kubernetes operations.');
    expect(logged).not.toContain('TypeScript');
  });
});

describe('GET /fit-reports/:id/improvement-plan', () => {
  it('serves the empty collection before any draft, 404 for missing/foreign', async () => {
    const instance = await build();
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);

    const empty = await planner.getPlan(reportId);
    expect(empty.statusCode).toBe(200);
    expect(empty.json<FitReportPlanResponse>()).toEqual({ run: null, plan: null, cached: false });

    const missing = await planner.getPlan('99999999-9999-4999-8999-999999999999');
    expect(missing.statusCode).toBe(404);
  });
});

describe('POST /improvement-plans/:id/review', () => {
  it('one-shot: 200 with trimmed notes, then 409 PLAN_ALREADY_REVIEWED; 404 foreign', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);
    const planId = (await planner.draft(reportId)).json<FitReportPlanResponse>().plan?.id ?? '';

    const reviewed = await planner.reviewPlan(planId, { notes: '  Looks right.  ' });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json<{ reviewStatus: string; notes: string }>().notes).toBe('Looks right.');

    const again = await planner.reviewPlan(planId);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('PLAN_ALREADY_REVIEWED');

    const stranger = await authedPlanner(instance);
    expect((await stranger.reviewPlan(planId)).statusCode).toBe(404);
  });
});

describe('PATCH /plan-items/:id', () => {
  it('full replacement of status+priority; immutable fields rejected by schema; 404 foreign', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const planner = await authedPlanner(instance);
    const { reportId } = await seededReviewedReport(instance, planner);
    const drafted = (await planner.draft(reportId)).json<FitReportPlanResponse>();
    const itemId = drafted.plan?.items[0]?.id ?? '';

    const updated = await planner.patchItem(itemId, { status: 'complete', priority: 'low' });
    expect(updated.statusCode).toBe(200);
    const body = updated.json<{ status: string; priority: string; action: string }>();
    expect(body.status).toBe('complete');
    expect(body.priority).toBe('low');
    expect(body.action).toBe('Publish a fictional Kubernetes lab writeup.');

    const editAttempt = await planner.patchItem(itemId, {
      status: 'complete',
      priority: 'low',
      action: 'edited draft text',
    });
    expect(editAttempt.statusCode).toBe(400);

    const stranger = await authedPlanner(instance);
    expect(
      (await stranger.patchItem(itemId, { status: 'dropped', priority: 'low' })).statusCode,
    ).toBe(404);
  });
});
