// POST /postings/:id/fit + GET /postings/:id/fit + POST /fit-reports/:id/review
// integration tests (M1-10). Every posting, requirement, profile row, and
// criteria value here is fictional (RISKS P-01). Laws pinned: scoring is
// deterministic and LLM-free (no provider configured in ANY test here), the
// engine payload round-trips POST -> GET, re-scoring APPENDS, exclusions are
// explicit quote-cited verdicts, flagged input renders as verification
// states, review is one-shot, unarchive restores 'scored' (P9), reads are
// never archived-gated (A4), and no quote/rationale text ever enters logs.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type FitReportResponse, type SearchCriteriaData } from '@careerforge/core';
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
  'Requirements: 5+ years TypeScript experience.',
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
    createdAt: new Date('2026-07-18T12:00:00.000Z'),
    ...overrides,
  };
}

function requirementInsert(overrides: Partial<RequirementInsert> = {}): RequirementInsert {
  return {
    kind: 'must_have',
    category: 'language',
    text: 'Fictional TypeScript requirement',
    sourceQuote: '5+ years TypeScript experience.',
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
async function authedScorer(instance: FastifyInstance) {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `scorer.${userSequence}.fictional@example.com`,
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
  const seedRun = (postingId: string, requirements: RequirementInsert[]) =>
    extractions.persistExtraction(user.id, postingId, [runInsert()], requirements);
  const seedProfileAndCriteria = async () => {
    await profileRepo.syncProfile(user.id, {
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
    await criteriaRepo.upsert(user.id, CRITERIA);
  };
  const score = (id: string, extraHeaders: Record<string, string> = {}) =>
    instance.inject({
      method: 'POST',
      url: `/postings/${id}/fit`,
      headers: { ...headers, ...extraHeaders },
    });
  const getFit = (id: string) =>
    instance.inject({ method: 'GET', url: `/postings/${id}/fit`, headers });
  const review = (reportId: string, payload?: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/review`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const patchPosting = (id: string, payload: Record<string, unknown>) =>
    instance.inject({ method: 'PATCH', url: `/postings/${id}`, headers, payload });
  const postingStatus = async (id: string) => {
    const response = await instance.inject({ method: 'GET', url: `/postings/${id}`, headers });
    return response.json<{ status: string }>().status;
  };

  return {
    user,
    headers,
    paste,
    seedRun,
    seedProfileAndCriteria,
    score,
    getFit,
    review,
    patchPosting,
    postingStatus,
  };
}

/** A fully seeded scoreable posting: pasted, extracted (ok run), profile +
 *  criteria in place. */
async function seededScorer(instance: FastifyInstance, requirements?: RequirementInsert[]) {
  const scorer = await authedScorer(instance);
  const postingId = await scorer.paste(FICTIONAL_POSTING);
  await scorer.seedRun(postingId, requirements ?? [requirementInsert()]);
  await scorer.seedProfileAndCriteria();
  return { ...scorer, postingId };
}

describe('POST /postings/:id/fit', () => {
  it('401s without a session and 403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const anonymous = await instance.inject({
      method: 'POST',
      url: '/postings/11111111-1111-4111-8111-111111111111/fit',
    });
    expect(anonymous.statusCode).toBe(401);

    const scorer = await seededScorer(instance);
    const crossOrigin = await scorer.score(scorer.postingId, {
      origin: 'https://fictional-evil.example',
    });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it('201-scores: 7 sub-scores in dimension order, draft report, posting flips extracted → scored', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    expect(await scorer.postingStatus(scorer.postingId)).toBe('extracted');

    const response = await scorer.score(scorer.postingId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResponse>();
    expect(body.postingId).toBe(scorer.postingId);
    expect(body.reviewStatus).toBe('draft');
    expect(body.notes).toBeNull();
    expect(body.report.verdict).toBe('scored');
    expect(body.report.exclusions).toEqual([]);
    expect(body.report.inputFlagged).toBe(false);
    expect(body.report.unscoredRequirements).toEqual([]);
    expect(body.report.forcedLowestPriority).toEqual({ applied: false, matchedSlugs: [] });
    expect(body.report.subScores.map((subScore) => subScore.dimension)).toEqual([
      'min_quals',
      'technical',
      'domain',
      'seniority',
      'comp_location',
      'priority',
      'stretch',
    ]);
    for (const subScore of body.report.subScores) {
      expect(subScore.score).toBeGreaterThanOrEqual(0);
      expect(subScore.score).toBeLessThanOrEqual(1);
      expect(subScore.rationale.length).toBeGreaterThan(0);
    }
    expect(await scorer.postingStatus(scorer.postingId)).toBe('scored');
  });

  it('GET serves the persisted report byte-equal to the POST response', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    const posted = await scorer.score(scorer.postingId);
    const fetched = await scorer.getFit(scorer.postingId);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ report: FitReportResponse }>().report).toEqual(
      posted.json<FitReportResponse>(),
    );
  });

  it('a flagged run scores with inputFlagged=true and the failed row as a verification-state unscored entry', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance, [
      requirementInsert(),
      requirementInsert({
        text: 'Fictional unverifiable requirement',
        sourceQuote: 'a quote the posting never said',
        quoteVerified: false,
      }),
    ]);
    const response = await scorer.score(scorer.postingId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResponse>();
    expect(body.report.inputFlagged).toBe(true);
    expect(body.report.unscoredRequirements).toHaveLength(1);
    expect(body.report.unscoredRequirements[0]?.reason).toBe('failed_verification');
    expect(body.report.subScores).toHaveLength(7);
    // The posting still flips: flagged means review, not absence.
    expect(await scorer.postingStatus(scorer.postingId)).toBe('scored');
  });

  it('a fired hard filter is an EXPLICIT quote-cited exclusion verdict — with the full breakdown intact', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance, [
      requirementInsert(),
      requirementInsert({
        category: 'other',
        text: 'Fictional contract engagement',
        sourceQuote: 'This is a contract position.',
      }),
    ]);
    const response = await scorer.score(scorer.postingId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResponse>();
    expect(body.report.verdict).toBe('excluded');
    expect(body.report.exclusions).toEqual([
      {
        filterKey: 'employment_type',
        matchedValue: 'contract',
        postingQuote: 'This is a contract position.',
      },
    ]);
    expect(body.report.subScores).toHaveLength(7); // informative breakdown stays
  });

  it('re-scoring APPENDS: two reports exist, GET serves the latest', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    const first = await scorer.score(scorer.postingId);
    const second = await scorer.score(scorer.postingId);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstId = first.json<FitReportResponse>().id;
    const secondId = second.json<FitReportResponse>().id;
    expect(firstId).not.toBe(secondId);

    const { rows } = await handle.pool.query<{ n: string }>(
      'select count(*) as n from fit_reports where posting_id = $1',
      [scorer.postingId],
    );
    expect(rows[0]?.n).toBe('2');
    expect(
      await scorer.getFit(scorer.postingId).then((r) => r.json<{ report: { id: string } }>()),
    ).toMatchObject({ report: { id: secondId } });
  });

  it('409s an archived posting (POSTING_ARCHIVED) — unarchive before scoring', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    await scorer.patchPosting(scorer.postingId, { status: 'archived' });
    const response = await scorer.score(scorer.postingId);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('POSTING_ARCHIVED');
  });

  it('409s a posting with no requirement-bearing run (POSTING_NOT_EXTRACTED)', async () => {
    const instance = await build();
    const scorer = await authedScorer(instance);
    const postingId = await scorer.paste(FICTIONAL_POSTING);
    await scorer.seedProfileAndCriteria();
    const response = await scorer.score(postingId);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('POSTING_NOT_EXTRACTED');
  });

  it('404s when no criteria exist yet (CRITERIA_NOT_FOUND — set criteria first)', async () => {
    const instance = await build();
    const scorer = await authedScorer(instance);
    const postingId = await scorer.paste(FICTIONAL_POSTING);
    await scorer.seedRun(postingId, [requirementInsert()]);
    const response = await scorer.score(postingId);
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('CRITERIA_NOT_FOUND');
  });

  it('404s unknown and foreign postings identically; 400s a malformed id value-free', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    const unknown = await scorer.score('11111111-1111-4111-8111-111111111111');
    expect(unknown.statusCode).toBe(404);

    const stranger = await authedScorer(instance);
    await stranger.seedProfileAndCriteria();
    const foreign = await stranger.score(scorer.postingId);
    expect(foreign.statusCode).toBe(404);

    const malformed = await scorer.score('not-a-uuid');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('not-a-uuid');
  });

  it('never logs requirement text, quotes, profile text, or rationale — ids/counts/booleans only', async () => {
    const infoLines: string[] = [];
    const instance = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      logStream: { write: (line) => infoLines.push(line) },
    });
    app = instance;
    const scorer = await seededScorer(instance);
    const response = await scorer.score(scorer.postingId);
    expect(response.statusCode).toBe(201);

    const persisted = infoLines.find((line) => line.includes('fit report persisted'));
    expect(persisted).toBeDefined();
    expect(persisted).toContain('subScoreCount');
    expect(persisted).toContain('verdict');
    const allLogs = infoLines.join('');
    expect(allLogs).not.toContain('5+ years TypeScript');
    expect(allLogs).not.toContain('Fictional TypeScript requirement');
    expect(allLogs).not.toContain('Fictional Gizmo Works');
    expect(allLogs).not.toContain('rationale');
  });
});

describe('GET /postings/:id/fit', () => {
  it('serves report: null before the first scoring (empty collection, not 404) and 404s unknown postings', async () => {
    const instance = await build();
    const scorer = await authedScorer(instance);
    const postingId = await scorer.paste(FICTIONAL_POSTING);
    const empty = await scorer.getFit(postingId);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ report: null });

    const unknown = await scorer.getFit('11111111-1111-4111-8111-111111111111');
    expect(unknown.statusCode).toBe(404);
  });

  it('reads are never archived-gated: an archived scored posting still serves its report (A4)', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    const posted = await scorer.score(scorer.postingId);
    await scorer.patchPosting(scorer.postingId, { status: 'archived' });
    const fetched = await scorer.getFit(scorer.postingId);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ report: FitReportResponse }>().report.id).toBe(
      posted.json<FitReportResponse>().id,
    );
  });
});

describe('POST /fit-reports/:id/review (one-shot, D8)', () => {
  it('marks reviewed with notes; the second attempt 409s (REPORT_ALREADY_REVIEWED)', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    const reportId = (await scorer.score(scorer.postingId)).json<FitReportResponse>().id;

    const reviewed = await scorer.review(reportId, { notes: '  fictional review note  ' });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toEqual({
      id: reportId,
      reviewStatus: 'reviewed',
      notes: 'fictional review note', // trimmed at the service boundary
    });

    const again = await scorer.review(reportId, { notes: 'fictional overwrite attempt' });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('REPORT_ALREADY_REVIEWED');

    // GET reflects the review; the first notes survive.
    const fetched = await scorer.getFit(scorer.postingId);
    const report = fetched.json<{ report: FitReportResponse }>().report;
    expect(report.reviewStatus).toBe('reviewed');
    expect(report.notes).toBe('fictional review note');
  });

  it('a body-less POST and whitespace-only notes both review with notes: null', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    const first = (await scorer.score(scorer.postingId)).json<FitReportResponse>().id;
    const bodyless = await scorer.review(first);
    expect(bodyless.statusCode).toBe(200);
    expect(bodyless.json<{ notes: string | null }>().notes).toBeNull();

    const second = (await scorer.score(scorer.postingId)).json<FitReportResponse>().id;
    const blank = await scorer.review(second, { notes: '   ' });
    expect(blank.statusCode).toBe(200);
    expect(blank.json<{ notes: string | null }>().notes).toBeNull();
  });

  it('404s unknown ids and foreign-owned reports identically; rejects NUL notes value-free', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    const reportId = (await scorer.score(scorer.postingId)).json<FitReportResponse>().id;

    const unknown = await scorer.review('11111111-1111-4111-8111-111111111111');
    expect(unknown.statusCode).toBe(404);

    const stranger = await authedScorer(instance);
    const foreign = await stranger.review(reportId, { notes: 'fictional foreign note' });
    expect(foreign.statusCode).toBe(404);

    const nul = await scorer.review(reportId, { notes: 'fictional\u0000note' });
    expect(nul.statusCode).toBe(400);
    expect(nul.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('unarchive restores scored (the P9 widening, route-pinned)', () => {
  it('score → archive → PATCH new restores scored, not extracted', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    await scorer.score(scorer.postingId);
    expect(await scorer.postingStatus(scorer.postingId)).toBe('scored');

    await scorer.patchPosting(scorer.postingId, { status: 'archived' });
    const restored = await scorer.patchPosting(scorer.postingId, { status: 'new' });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ status: string }>().status).toBe('scored');
  });

  it('without a fit report the widened law still restores extracted (M1-06 leg unchanged)', async () => {
    const instance = await build();
    const scorer = await seededScorer(instance);
    await scorer.patchPosting(scorer.postingId, { status: 'archived' });
    const restored = await scorer.patchPosting(scorer.postingId, { status: 'new' });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ status: string }>().status).toBe('extracted');
  });
});

describe('GET /fit-reports/:id/gaps + PATCH /gaps/:id (M1-11)', () => {
  type GapWire = {
    id: string;
    requirementId: string;
    classification: string;
    engineClassification: string;
    userOverridden: boolean;
    overrideNote: string | null;
    carriedVia: string | null;
    requirementText: string;
    requirementKind: string;
    requirementCategory: string;
  };
  type GapsWire = { gaps: GapWire[]; lostOverrides: number };

  async function scoredWithGaps(instance: FastifyInstance) {
    const scorer = await seededScorer(instance);
    const scored = await scorer.score(scorer.postingId);
    expect(scored.statusCode).toBe(201);
    const reportId = scored.json<FitReportResponse>().id;
    const getGaps = async (id: string) => {
      const response = await instance.inject({
        method: 'GET',
        url: `/fit-reports/${id}/gaps`,
        headers: scorer.headers,
      });
      return response;
    };
    const patchGap = (gapId: string, payload: Record<string, unknown>) =>
      instance.inject({ method: 'PATCH', url: `/gaps/${gapId}`, headers: scorer.headers, payload });
    return { ...scorer, reportId, getGaps, patchGap };
  }

  it('serves the report-scoped gap set with requirement join fields; the seeded case classifies have_undemonstrated', async () => {
    const instance = await build();
    const scorer = await scoredWithGaps(instance);
    const response = await scorer.getGaps(scorer.reportId);
    expect(response.statusCode).toBe(200);
    const body = response.json<GapsWire>();
    expect(body.lostOverrides).toBe(0);
    expect(body.gaps).toHaveLength(1);
    // Expert TypeScript named-skill link, no project/experience bridge in
    // the fixture profile: rung 2 by the ladder.
    expect(body.gaps[0]).toMatchObject({
      classification: 'have_undemonstrated',
      engineClassification: 'have_undemonstrated',
      userOverridden: false,
      overrideNote: null,
      carriedVia: null,
      requirementText: 'Fictional TypeScript requirement',
      requirementKind: 'must_have',
      requirementCategory: 'language',
    });
  });

  it('a report whose run has zero eligible requirements serves the R3 empty shape', async () => {
    const instance = await build();
    const scorer = await authedScorer(instance);
    const postingId = await scorer.paste(FICTIONAL_POSTING);
    await scorer.seedRun(postingId, [
      requirementInsert({ quoteVerified: false, sourceQuote: 'never matched this text' }),
    ]);
    await scorer.seedProfileAndCriteria();
    const scored = await scorer.score(postingId);
    expect(scored.statusCode).toBe(201);
    const reportId = scored.json<FitReportResponse>().id;
    const response = await instance.inject({
      method: 'GET',
      url: `/fit-reports/${reportId}/gaps`,
      headers: scorer.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<GapsWire>()).toEqual({ gaps: [], lostOverrides: 0 });
  });

  it('override round-trips with a trimmed note and survives a re-score via requirement_id', async () => {
    const instance = await build();
    const scorer = await scoredWithGaps(instance);
    const first = await scorer.getGaps(scorer.reportId);
    const gapId = first.json<GapsWire>().gaps[0]!.id;

    const patched = await scorer.patchGap(gapId, {
      classification: 'genuine_gap',
      note: '  actually unproven in production  ',
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<GapWire>()).toMatchObject({
      classification: 'genuine_gap',
      engineClassification: 'have_undemonstrated',
      userOverridden: true,
      overrideNote: 'actually unproven in production',
      carriedVia: null,
    });

    const rescored = await scorer.score(scorer.postingId);
    expect(rescored.statusCode).toBe(201);
    const newReportId = rescored.json<FitReportResponse>().id;
    expect(newReportId).not.toBe(scorer.reportId);
    const second = await scorer.getGaps(newReportId);
    const carried = second.json<GapsWire>();
    expect(carried.lostOverrides).toBe(0);
    expect(carried.gaps[0]).toMatchObject({
      classification: 'genuine_gap',
      engineClassification: 'have_undemonstrated',
      userOverridden: true,
      overrideNote: 'actually unproven in production',
      carriedVia: 'requirement_id',
    });
  });

  it('A2 full replacement on the wire: note absent clears, note null clears, classification null un-overrides', async () => {
    const instance = await build();
    const scorer = await scoredWithGaps(instance);
    const gapId = (await scorer.getGaps(scorer.reportId)).json<GapsWire>().gaps[0]!.id;

    await scorer.patchGap(gapId, { classification: 'genuine_gap', note: 'a kept note' });
    const absent = await scorer.patchGap(gapId, { classification: 'genuine_gap' });
    expect(absent.json<GapWire>().overrideNote).toBeNull();

    await scorer.patchGap(gapId, { classification: 'genuine_gap', note: 'another note' });
    const nulled = await scorer.patchGap(gapId, { classification: 'genuine_gap', note: null });
    expect(nulled.json<GapWire>().overrideNote).toBeNull();

    await scorer.patchGap(gapId, { classification: 'low_priority', note: 'pre-revert note' });
    const reverted = await scorer.patchGap(gapId, { classification: null });
    expect(reverted.statusCode).toBe(200);
    expect(reverted.json<GapWire>()).toMatchObject({
      classification: 'have_undemonstrated',
      userOverridden: false,
      overrideNote: null,
      carriedVia: null,
    });
  });

  it('rejects a sixth bucket and a classification-free body with value-free 400s', async () => {
    const instance = await build();
    const scorer = await scoredWithGaps(instance);
    const gapId = (await scorer.getGaps(scorer.reportId)).json<GapsWire>().gaps[0]!.id;
    expect((await scorer.patchGap(gapId, { classification: 'wont_fix' })).statusCode).toBe(400);
    expect((await scorer.patchGap(gapId, { note: 'no classification' })).statusCode).toBe(400);
  });

  it('missing, foreign, and malformed ids: 404/404/400, id-free bodies', async () => {
    const instance = await build();
    const scorer = await scoredWithGaps(instance);
    const missing = await scorer.getGaps('99999999-9999-4999-8999-999999999999');
    expect(missing.statusCode).toBe(404);

    const stranger = await authedScorer(instance);
    const foreign = await instance.inject({
      method: 'GET',
      url: `/fit-reports/${scorer.reportId}/gaps`,
      headers: stranger.headers,
    });
    expect(foreign.statusCode).toBe(404);

    const gapId = (await scorer.getGaps(scorer.reportId)).json<GapsWire>().gaps[0]!.id;
    const foreignPatch = await instance.inject({
      method: 'PATCH',
      url: `/gaps/${gapId}`,
      headers: stranger.headers,
      payload: { classification: 'have' },
    });
    expect(foreignPatch.statusCode).toBe(404);

    const malformed = await scorer.getGaps('not-a-uuid');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('not-a-uuid');
  });

  it('never logs requirement text, rationale, or override notes on the gap surfaces', async () => {
    const infoLines: string[] = [];
    const instance = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      logStream: { write: (line) => infoLines.push(line) },
    });
    app = instance;
    const scorer = await scoredWithGaps(instance);
    const gapId = (await scorer.getGaps(scorer.reportId)).json<GapsWire>().gaps[0]!.id;
    const patched = await scorer.patchGap(gapId, {
      classification: 'genuine_gap',
      note: 'secret-ish fictional note text',
    });
    expect(patched.statusCode).toBe(200);

    const overrideLine = infoLines.find((line) => line.includes('gap classification override'));
    expect(overrideLine).toBeDefined();
    expect(overrideLine).toContain('hasNote');
    const allLogs = infoLines.join('');
    expect(allLogs).not.toContain('secret-ish fictional note text');
    expect(allLogs).not.toContain('Fictional TypeScript requirement');
    expect(allLogs).not.toContain('Named skill');
    expect(allLogs).not.toContain('no project or experience');
  });
});
