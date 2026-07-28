import {
  FIT_DIMENSIONS,
  formatStageChangeDetail,
  type ApplicationGameplanResponse,
  type FitReportData,
  type SearchCriteriaData,
} from '@careerforge/core';
import {
  createExtractionsRepository,
  createFitReportsRepository,
  createProfileRepository,
  type ExtractionRunInsert,
  type RequirementInsert,
} from '@careerforge/db';
import { createMockProvider, type LlmProvider } from '@careerforge/llm';
import { createTestDb, resumeHeaderFixture, truncateAllTables } from '@careerforge/db/test-utils';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

// M7-07 (ADR-0019 layer L3): gameplan route integration tests (dockerized PG,
// mocked provider - NO live model, D10). The seeded report has TWO verified
// requirements: r1 = Kubernetes (genuine_gap, NO evidence) and r2 = TypeScript
// ('have' gap, one evidence link e1). The mock drafts are written against exactly
// that ref layout. The BOTH-tripwires planted-FAIL detection proofs live here
// (D4): each poisoned-but-schema-valid draft flags the run and writes NOTHING,
// and asserts the SPECIFIC route-log count so a neuter reddens exactly its rows.
// All fixture data fictional (RISKS P-01).

const handle = createTestDb();
const extractions = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);
const profileRepo = createProfileRepository(handle.db);

const FICTIONAL_POSTING = [
  'Senior TypeScript Engineer - Fictional Gadget Labs.',
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

function validStory() {
  return {
    requirementRef: 'r2',
    situation: 'A fictional team needed a resilient TypeScript platform.',
    task: 'Design and ship the core services.',
    action: 'Built the platform and mentored two engineers.',
    result: 'Delivered on time with strong test coverage.',
    citationRefs: ['e1'],
  };
}

function gameplanDraft(
  overrides: {
    strategySummary?: string;
    phaseStrategies?: Partial<Record<'apply' | 'screen' | 'interview' | 'offer', string>>;
    stories?: unknown[];
  } = {},
): string {
  return JSON.stringify({
    strategySummary:
      overrides.strategySummary ??
      'Lead with the fictional TypeScript platform; be honest about the operations gap.',
    phaseStrategies: {
      apply: overrides.phaseStrategies?.apply ?? 'Tailor the resume to the operations requirement.',
      screen: overrides.phaseStrategies?.screen ?? 'Frame the platform work as hands-on evidence.',
      interview:
        overrides.phaseStrategies?.interview ?? 'Rehearse the STAR story and name the gap plainly.',
      offer: overrides.phaseStrategies?.offer ?? 'Confirm the compensation band before deciding.',
    },
    stories: overrides.stories ?? [validStory()],
  });
}

const VALID_DRAFT = gameplanDraft();
// Row 9 negative: mid-sentence greeting words + a dotted tech name (socket.io) in
// clean prose - must NOT flag.
const CLEAN_WITH_DECOYS = gameplanDraft({
  strategySummary:
    'The best approach is a socket.io demo; thank the panel warmly and stay honest about gaps.',
});

// Row 1-4 message-likeness / no-URL.
const SALUTATION_DRAFT = gameplanDraft({
  phaseStrategies: { apply: 'Dear Hiring Team,\nHere is how I would pursue this role.' },
});
const SUBJECT_DRAFT = gameplanDraft({
  stories: [{ ...validStory(), action: 'Subject: Application for the fictional role' }],
});
const EMAIL_SUMMARY_DRAFT = gameplanDraft({
  strategySummary: 'If it helps, contact me at recruiter@example.com about the next steps here.',
});
const URL_PHASE_DRAFT = gameplanDraft({
  phaseStrategies: { screen: 'Review the platform docs at https://example.com before the call.' },
});
// Row 5-8 story-citation provenance.
const FABRICATED_EVIDENCE_DRAFT = gameplanDraft({
  stories: [{ ...validStory(), citationRefs: ['e9'] }],
});
const FABRICATED_REQUIREMENT_DRAFT = gameplanDraft({
  stories: [{ ...validStory(), requirementRef: 'r9' }],
});
const CROSS_REQUIREMENT_DRAFT = gameplanDraft({
  stories: [{ ...validStory(), requirementRef: 'r1', citationRefs: ['e1'] }],
});
const DUPLICATE_CITATION_DRAFT = gameplanDraft({
  stories: [{ ...validStory(), citationRefs: ['e1', 'e1'] }],
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
    createdAt: new Date('2026-07-25T09:00:00.000Z'),
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

function reportData(evidenceRequirementId?: string): FitReportData {
  return {
    verdict: 'scored',
    exclusions: [],
    subScores: FIT_DIMENSIONS.map((dimension, index) => ({
      dimension,
      score: 0.5,
      rationale: `fictional ${dimension} rationale`,
      evidence:
        index === 0 && evidenceRequirementId
          ? [
              {
                requirementId: evidenceRequirementId,
                profileSkillId: null,
                profileProjectId: null,
                profileExperienceId: null,
                postingQuote: '5+ years TypeScript experience',
                profileQuote: 'Shipped a fictional TypeScript platform',
                strength: 'adjacent' as const,
              },
            ]
          : [],
    })),
    unscoredRequirements: [],
    forcedLowestPriority: { applied: false, matchedSlugs: [] },
    inputFlagged: false,
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
  app = await buildApp(buildTestEnv(), { dbHandle: handle, ...deps });
  return app;
}

let userSequence = 0;
async function authedCandidate(instance: FastifyInstance) {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `gameplan.${userSequence}.fictional@example.com`,
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
  const draft = (
    postingId: string,
    extra: { headers?: Record<string, string>; body?: unknown } = {},
  ) =>
    instance.inject({
      method: 'POST',
      url: `/postings/${postingId}/gameplan`,
      headers: { ...headers, ...(extra.headers ?? {}) },
      ...(extra.body === undefined ? {} : { payload: extra.body as Record<string, unknown> }),
    });
  const getGameplan = (postingId: string) =>
    instance.inject({ method: 'GET', url: `/postings/${postingId}/gameplan`, headers });
  const review = (gameplanId: string, payload?: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/application-gameplans/${gameplanId}/review`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const toggleCheck = (gameplanId: string, payload: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/application-gameplans/${gameplanId}/checks`,
      headers,
      payload: payload as Record<string, unknown>,
    });

  return { user, headers, paste, draft, getGameplan, review, toggleCheck };
}

async function seededReviewedReport(
  instance: FastifyInstance,
  candidate: Awaited<ReturnType<typeof authedCandidate>>,
  { review = true }: { review?: boolean } = {},
) {
  const postingId = await candidate.paste(FICTIONAL_POSTING);
  const extraction = await extractions.persistExtraction(
    candidate.user.id,
    postingId,
    [runInsert()],
    [
      requirementInsert(),
      requirementInsert({
        text: '5+ years TypeScript experience',
        sourceQuote: '5+ years TypeScript experience.',
      }),
    ],
  );
  await profileRepo.syncProfile(candidate.user.id, {
    ...resumeHeaderFixture(),
    skills: [
      { name: 'TypeScript', category: 'language', level: 'expert', years: 8, lastUsed: null },
    ],
    experiences: [],
    projects: [],
  });
  const run = extraction.runs[0]!;
  const seeded = extraction.requirements;
  const outcome = await fitRepo.persistFitReport(
    candidate.user.id,
    postingId,
    run.id,
    reportData(seeded[1]?.id),
    CRITERIA,
    [
      {
        requirementId: seeded[0]!.id,
        classification: 'genuine_gap',
        rationale: 'No cluster operations evidence in the fictional profile.',
      },
      {
        requirementId: seeded[1]!.id,
        classification: 'have',
        rationale: 'Named fictional skill at expert level.',
      },
    ],
  );
  if (review) {
    const reviewed = await instance.inject({
      method: 'POST',
      url: `/fit-reports/${outcome.report.id}/review`,
      headers: candidate.headers,
    });
    expect(reviewed.statusCode).toBe(200);
  }
  return { postingId, reportId: outcome.report.id, requirements: seeded };
}

/** Build with an info-level log stream captured, draft with the mock, and return
 *  the 'gameplan draft' log record so the D4 count assertions can read the
 *  value-free telemetry. */
async function draftCapturingLog(mockText: string) {
  const lines: string[] = [];
  const provider = createMockProvider([{ text: mockText }]);
  app = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
    dbHandle: handle,
    llmProvider: provider,
    logStream: {
      write: (line: string) => {
        lines.push(line);
      },
    },
  });
  const candidate = await authedCandidate(app);
  const { postingId } = await seededReviewedReport(app, candidate);
  const drafted = await candidate.draft(postingId);
  const record = lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .find((entry): entry is Record<string, unknown> => entry?.msg === 'gameplan draft');
  return { drafted, candidate, postingId, provider, record };
}

async function gameplanRowCounts() {
  const result = await handle.pool.query<{ g: string; p: string; s: string; c: string }>(
    `select (select count(*) from application_gameplans) as g,
            (select count(*) from gameplan_phase_strategies) as p,
            (select count(*) from gameplan_stories) as s,
            (select count(*) from gameplan_story_citations) as c`,
  );
  return result.rows[0]!;
}

describe('POST /postings/:id/gameplan - resolution preconditions', () => {
  it('401 without a session; 404 unknown posting; 409 NO_FIT_REPORT; 409 REPORT_NOT_REVIEWED', async () => {
    const instance = await build({ llmProvider: createMockProvider([]) });
    const anonymous = await instance.inject({
      method: 'POST',
      url: '/postings/11111111-1111-4111-8111-111111111111/gameplan',
    });
    expect(anonymous.statusCode).toBe(401);

    const candidate = await authedCandidate(instance);
    const unknown = await candidate.draft('11111111-1111-4111-8111-111111111111');
    expect(unknown.statusCode).toBe(404);

    const bareId = await candidate.paste(FICTIONAL_POSTING);
    const noReport = await candidate.draft(bareId);
    expect(noReport.statusCode).toBe(409);
    expect(noReport.json<{ error: { code: string } }>().error.code).toBe('NO_FIT_REPORT');

    const candidate2 = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate2, { review: false });
    const unreviewed = await candidate2.draft(postingId);
    expect(unreviewed.statusCode).toBe(409);
    expect(unreviewed.json<{ error: { code: string } }>().error.code).toBe('REPORT_NOT_REVIEWED');
  });

  it('503 when no provider is configured (after the cheap preconditions)', async () => {
    const instance = await build();
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const refused = await candidate.draft(postingId);
    expect(refused.statusCode).toBe(503);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('502 when the provider call throws (audit runs still recorded)', async () => {
    const throwing: LlmProvider = {
      name: 'mock',
      generate: () => Promise.reject(new Error('upstream boom')),
    };
    const instance = await build({ llmProvider: throwing });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const failed = await candidate.draft(postingId);
    expect(failed.statusCode).toBe(502);
    expect(failed.json<{ error: { code: string } }>().error.code).toBe('LLM_UPSTREAM_ERROR');
    // The wire call's audit row persisted on the error path; no gameplan.
    const runs = await handle.pool.query(`select count(*) as n from application_gameplan_runs`);
    expect(runs.rows[0]).toEqual({ n: '1' });
    expect((await gameplanRowCounts()).g).toBe('0');
  });
});

describe('POST /postings/:id/gameplan - BOTH tripwires planted-FAIL proofs (D4)', () => {
  it('row 9 (clean, load-bearing negative): 201, gameplan non-null, all counts zero, 4 phases, citation persisted', async () => {
    const { drafted, record } = await draftCapturingLog(CLEAN_WITH_DECOYS);
    expect(drafted.statusCode).toBe(201);
    const body = drafted.json<ApplicationGameplanResponse>();
    expect(body.gameplan).not.toBeNull();
    expect(body.run!.status).toBe('ok');
    expect(record).toMatchObject({
      messageLikenessHitCount: 0,
      externalPointerHitCount: 0,
      fabricatedRefCount: 0,
      crossRequirementCiteCount: 0,
      duplicateCitationCount: 0,
    });
    expect(body.gameplan!.phases).toHaveLength(4);
    expect(body.gameplan!.stories).toHaveLength(1);
    expect(body.gameplan!.stories[0]!.citations).toHaveLength(1);
    expect(await gameplanRowCounts()).toEqual({ g: '1', p: '4', s: '1', c: '1' });
  });

  it('row 1 message-likeness: a salutation line opening a phase strategy flags (nothing written)', async () => {
    const { drafted, record } = await draftCapturingLog(SALUTATION_DRAFT);
    expect(drafted.statusCode).toBe(201);
    const body = drafted.json<ApplicationGameplanResponse>();
    expect(body.gameplan).toBeNull();
    expect(body.run!.status).toBe('flagged');
    expect(record!.messageLikenessHitCount as number).toBeGreaterThanOrEqual(1);
    expect(await gameplanRowCounts()).toEqual({ g: '0', p: '0', s: '0', c: '0' });
  });

  it('row 2 message-likeness: a Subject: line inside a story field flags', async () => {
    const { drafted, record } = await draftCapturingLog(SUBJECT_DRAFT);
    expect(drafted.statusCode).toBe(201);
    expect(drafted.json<ApplicationGameplanResponse>().run!.status).toBe('flagged');
    expect(record!.messageLikenessHitCount as number).toBeGreaterThanOrEqual(1);
    expect(await gameplanRowCounts()).toEqual({ g: '0', p: '0', s: '0', c: '0' });
  });

  it('row 3 message-likeness + no-URL: an embedded email in the summary flags BOTH counters', async () => {
    const { drafted, record } = await draftCapturingLog(EMAIL_SUMMARY_DRAFT);
    expect(drafted.statusCode).toBe(201);
    expect(drafted.json<ApplicationGameplanResponse>().run!.status).toBe('flagged');
    expect(record!.messageLikenessHitCount as number).toBeGreaterThanOrEqual(1);
    expect(record!.externalPointerHitCount as number).toBeGreaterThanOrEqual(1);
    expect(await gameplanRowCounts()).toEqual({ g: '0', p: '0', s: '0', c: '0' });
  });

  it('row 4 no-URL (INDEPENDENCE): an https URL in a phase strategy flags external-pointer ONLY', async () => {
    const { drafted, record } = await draftCapturingLog(URL_PHASE_DRAFT);
    expect(drafted.statusCode).toBe(201);
    expect(drafted.json<ApplicationGameplanResponse>().run!.status).toBe('flagged');
    expect(record!.externalPointerHitCount as number).toBeGreaterThanOrEqual(1);
    // Independence: message-likeness stays clean, so neutering it leaves row 4 green.
    expect(record!.messageLikenessHitCount).toBe(0);
    expect(await gameplanRowCounts()).toEqual({ g: '0', p: '0', s: '0', c: '0' });
  });

  it('row 5 story-citation: a story citing an e-ref never sent flags fabricatedRef', async () => {
    const { drafted, record } = await draftCapturingLog(FABRICATED_EVIDENCE_DRAFT);
    expect(drafted.statusCode).toBe(201);
    expect(drafted.json<ApplicationGameplanResponse>().run!.status).toBe('flagged');
    expect(record!.fabricatedRefCount as number).toBeGreaterThanOrEqual(1);
    expect(await gameplanRowCounts()).toEqual({ g: '0', p: '0', s: '0', c: '0' });
  });

  it('row 6 story-citation: a story whose requirementRef was never sent flags fabricatedRef', async () => {
    const { drafted, record } = await draftCapturingLog(FABRICATED_REQUIREMENT_DRAFT);
    expect(drafted.statusCode).toBe(201);
    expect(drafted.json<ApplicationGameplanResponse>().run!.status).toBe('flagged');
    expect(record!.fabricatedRefCount as number).toBeGreaterThanOrEqual(1);
    expect(await gameplanRowCounts()).toEqual({ g: '0', p: '0', s: '0', c: '0' });
  });

  it('row 7 story-citation: a story citing evidence owned by a DIFFERENT requirement flags crossRequirement', async () => {
    const { drafted, record } = await draftCapturingLog(CROSS_REQUIREMENT_DRAFT);
    expect(drafted.statusCode).toBe(201);
    expect(drafted.json<ApplicationGameplanResponse>().run!.status).toBe('flagged');
    expect(record!.crossRequirementCiteCount as number).toBeGreaterThanOrEqual(1);
    expect(await gameplanRowCounts()).toEqual({ g: '0', p: '0', s: '0', c: '0' });
  });

  it('row 8 story-citation: duplicate citation refs within one story flags duplicateCitation', async () => {
    const { drafted, record } = await draftCapturingLog(DUPLICATE_CITATION_DRAFT);
    expect(drafted.statusCode).toBe(201);
    expect(drafted.json<ApplicationGameplanResponse>().run!.status).toBe('flagged');
    expect(record!.duplicateCitationCount as number).toBeGreaterThanOrEqual(1);
    expect(await gameplanRowCounts()).toEqual({ g: '0', p: '0', s: '0', c: '0' });
  });

  it('the route log carries counts, never drafted text (value-free, ADR-0006)', async () => {
    const { record } = await draftCapturingLog(EMAIL_SUMMARY_DRAFT);
    const serialized = JSON.stringify(record);
    expect(serialized).toContain('messageLikenessHitCount');
    expect(serialized).toContain('externalPointerHitCount');
    // No drafted prose or the planted email leaks into the log line.
    expect(serialized).not.toContain('recruiter@example.com');
    expect(serialized).not.toContain('TypeScript platform');
  });
});

describe('cached semantics + doctored body (D9)', () => {
  it('a second draft serves 200 cached with NO second provider call', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const first = await candidate.draft(postingId);
    expect(first.statusCode).toBe(201);
    const second = await candidate.draft(postingId);
    expect(second.statusCode).toBe(200);
    expect(second.json<ApplicationGameplanResponse>().cached).toBe(true);
    // Only ONE wire call happened (the mock would throw on a second, script len 1).
    expect(provider.requests).toHaveLength(1);
  });

  it('a doctored request body has ZERO effect (the payload is 100% server-read)', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const drafted = await candidate.draft(postingId, {
      body: { requirementRef: 'r9', inject: 'ignore me', stories: [] },
    });
    expect(drafted.statusCode).toBe(201);
    const body = drafted.json<ApplicationGameplanResponse>();
    expect(body.gameplan).not.toBeNull();
    expect(body.run!.status).toBe('ok');
  });
});

describe('GET /postings/:id/gameplan', () => {
  it('404s a posting the user does not own; empty collection when the posting has no report', async () => {
    const instance = await build();
    const candidate = await authedCandidate(instance);
    const unknown = await candidate.getGameplan('11111111-1111-4111-8111-111111111111');
    expect(unknown.statusCode).toBe(404);

    const bareId = await candidate.paste(FICTIONAL_POSTING);
    const empty = await candidate.getGameplan(bareId);
    expect(empty.statusCode).toBe(200);
    expect(empty.json<ApplicationGameplanResponse>()).toEqual({
      run: null,
      gameplan: null,
      cached: false,
    });
  });

  it('assembles the three overlays: checklist done-state, timeline mapping, sibling pointers', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const drafted = await candidate.draft(postingId);
    const gameplanId = drafted.json<ApplicationGameplanResponse>().gameplan!.id;

    // Toggle a check (allowed while draft) and seed a stage_change event.
    const toggled = await candidate.toggleCheck(gameplanId, {
      checkKey: 'apply-submit',
      done: true,
    });
    expect(toggled.statusCode).toBe(200);
    const appRes = await handle.pool.query<{ id: string }>(
      `insert into applications (user_id, posting_id, stage) values ($1, $2, 'screen') returning id`,
      [candidate.user.id, postingId],
    );
    await handle.pool.query(
      `insert into application_events (user_id, application_id, kind, detail, occurred_on)
       values ($1, $2, 'stage_change', $3, '2026-07-22')`,
      [candidate.user.id, appRes.rows[0]!.id, formatStageChangeDetail('applied', 'screen')],
    );

    const view = (await candidate.getGameplan(postingId)).json<ApplicationGameplanResponse>();
    const applyPhase = view.gameplan!.phases.find((phase) => phase.phase === 'apply')!;
    // Checklist overlay: the toggled item reads done: true, the rest false.
    expect(applyPhase.checklist.find((item) => item.key === 'apply-submit')!.done).toBe(true);
    expect(applyPhase.checklist.find((item) => item.key === 'apply-tailor-resume')!.done).toBe(
      false,
    );
    // Timeline overlay: applied->screen attaches to the screen phase.
    const screenPhase = view.gameplan!.phases.find((phase) => phase.phase === 'screen')!;
    expect(screenPhase.stageEvents).toEqual([
      { occurredOn: '2026-07-22', fromStage: 'applied', toStage: 'screen' },
    ]);
    // Sibling pointers: none seeded here.
    expect(view.gameplan!.siblings).toEqual({ improvementPlan: null, interviewPrep: null });
  });
});

describe('review CAS + checks toggle', () => {
  it('one-shot review: 200, then 409 already reviewed, then 404 for a foreign id', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const gameplanId = (await candidate.draft(postingId)).json<ApplicationGameplanResponse>()
      .gameplan!.id;

    const reviewed = await candidate.review(gameplanId, { notes: '  Solid plan.  ' });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json<{ reviewStatus: string; notes: string }>().reviewStatus).toBe('reviewed');
    expect(reviewed.json<{ notes: string }>().notes).toBe('Solid plan.');

    const again = await candidate.review(gameplanId);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('GAMEPLAN_ALREADY_REVIEWED');

    const foreign = await candidate.review('00000000-0000-4000-8000-000000000000');
    expect(foreign.statusCode).toBe(404);
  });

  it('checks toggle returns the FULL overlay, is allowed after review, and 400s an unknown key', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const gameplanId = (await candidate.draft(postingId)).json<ApplicationGameplanResponse>()
      .gameplan!.id;
    await candidate.review(gameplanId);

    // Allowed regardless of reviewStatus (D6).
    const toggled = await candidate.toggleCheck(gameplanId, {
      checkKey: 'interview-star-rehearse',
      done: true,
    });
    expect(toggled.statusCode).toBe(200);
    const checklist = toggled.json<{ checklist: { key: string; done: boolean }[] }>().checklist;
    expect(checklist).toHaveLength(11);
    expect(checklist.find((item) => item.key === 'interview-star-rehearse')!.done).toBe(true);

    const badKey = await candidate.toggleCheck(gameplanId, {
      checkKey: 'not-a-real-key',
      done: true,
    });
    expect(badKey.statusCode).toBe(400);

    const foreign = await candidate.toggleCheck('00000000-0000-4000-8000-000000000000', {
      checkKey: 'apply-submit',
      done: true,
    });
    expect(foreign.statusCode).toBe(404);
  });
});
