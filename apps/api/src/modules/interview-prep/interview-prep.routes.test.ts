// POST/GET /postings/:id/interview-prep + POST /interview-preps/:id/review
// integration tests (M3-04). Every posting, requirement, profile row, and
// criteria value here is fictional (RISKS P-01). Laws pinned: the posting
// route resolves the LATEST report and requires it reviewed (gate decision
// (a)); the strict === true verified filter refuses all-unverified BEFORE any
// paid call (condition 1 + decision (e)); one prep per report (200-existing,
// no force); non-ok terminals are 201 results; the CITATION tripwire
// (fabricated ref / cross-requirement evidence) and the BIDIRECTIONAL
// DISCLOSURE tripwire (missing disclosure on an obliged requirement /
// spurious disclosure on an unobliged one) each flag the run with NO prep
// row; disclosures carry the server-resolved gap classification + read-time
// learningPlans pointer (condition 3); review is one-shot CAS; no
// question/point/quote text ever enters logs.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  FIT_DIMENSIONS,
  type FitReportData,
  type InterviewPrepResponse,
  type SearchCriteriaData,
} from '@careerforge/core';
import { createMockProvider } from '@careerforge/llm';
import {
  createExtractionsRepository,
  createFitReportsRepository,
  createLearningPlansRepository,
  createProfileRepository,
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
const fitRepo = createFitReportsRepository(handle.db);
const profileRepo = createProfileRepository(handle.db);
const learningRepo = createLearningPlansRepository(handle.db);

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

// The seeded report has TWO verified requirements: r1 = Kubernetes
// (genuine_gap, NO evidence — disclosure OBLIGED) and r2 = TypeScript
// ('have' gap, one evidence link e1 — disclosure FORBIDDEN). The mock drafts
// below are written against exactly that ref layout.

/** The happy path: an obliged disclosure on r1, own-requirement evidence on
 *  r2 — every tripwire's allow-path in one draft. */
const VALID_DRAFT = JSON.stringify({
  questions: [
    {
      requirementRef: 'r1',
      kind: 'technical',
      question: 'How would you approach operating Kubernetes for this fictional service?',
      evidencePoints: [],
      gapDisclosures: [
        'Be upfront: no production Kubernetes operations yet; point to the learning plan.',
      ],
    },
    {
      requirementRef: 'r2',
      kind: 'behavioral',
      question: 'Walk me through a TypeScript system you shipped.',
      evidencePoints: [
        { evidenceRef: 'e1', text: 'Speak from the fictional platform work the quote shows.' },
      ],
      gapDisclosures: [],
    },
  ],
});

/** Cites a requirement ref the payload never contained. */
const FABRICATED_REQUIREMENT_DRAFT = JSON.stringify({
  questions: [
    {
      requirementRef: 'r9',
      kind: 'technical',
      question: 'Grounded-sounding but uncited question?',
      evidencePoints: [],
      gapDisclosures: [],
    },
  ],
});

/** Cites r2's evidence on an r1 question — the cross-requirement bleed. */
const CROSS_BLED_DRAFT = JSON.stringify({
  questions: [
    {
      requirementRef: 'r1',
      kind: 'technical',
      question: 'Kubernetes question misusing TypeScript evidence?',
      evidencePoints: [{ evidenceRef: 'e1', text: 'Evidence borrowed from another requirement.' }],
      gapDisclosures: ['Honest-sounding disclosure.'],
    },
  ],
});

/** r1 is disclosure-obliged (genuine_gap) but the question stays silent. */
const MISSING_DISCLOSURE_DRAFT = JSON.stringify({
  questions: [
    {
      requirementRef: 'r1',
      kind: 'technical',
      question: 'Kubernetes question that hides the gap?',
      evidencePoints: [],
      gapDisclosures: [],
    },
  ],
});

/** r2 carries a 'have' gap — a disclosure there is spurious (it would stamp
 *  an incoherent badge; the review seat's bidirectional condition). */
const SPURIOUS_DISCLOSURE_DRAFT = JSON.stringify({
  questions: [
    {
      requirementRef: 'r2',
      kind: 'behavioral',
      question: 'TypeScript question with an invented gap?',
      evidencePoints: [],
      gapDisclosures: ['Claims a gap the report does not show.'],
    },
  ],
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
  app = await buildApp(env, { dbHandle: handle, ...deps });
  return app;
}

let userSequence = 0;
async function authedCandidate(instance: FastifyInstance) {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `interview.${userSequence}.fictional@example.com`,
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
  const draft = (postingId: string, extraHeaders: Record<string, string> = {}) =>
    instance.inject({
      method: 'POST',
      url: `/postings/${postingId}/interview-prep`,
      headers: { ...headers, ...extraHeaders },
    });
  const getPrep = (postingId: string) =>
    instance.inject({ method: 'GET', url: `/postings/${postingId}/interview-prep`, headers });
  const reviewPrep = (prepId: string, payload?: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/interview-preps/${prepId}/review`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  return { user, headers, paste, draft, getPrep, reviewPrep };
}

interface SeedOptions {
  review?: boolean;
  requirements?: RequirementInsert[];
}

/** Full fictional chain seeded via repositories for DETERMINISTIC gap
 *  classifications: posting → ok extraction (r1 Kubernetes, r2 TypeScript)
 *  → profile → fit report with r2 evidence + gaps (r1 genuine_gap, r2 have)
 *  → REVIEWED via the route (the drafting gate). */
async function seededReviewedReport(
  instance: FastifyInstance,
  candidate: Awaited<ReturnType<typeof authedCandidate>>,
  { review = true, requirements }: SeedOptions = {},
) {
  const postingId = await candidate.paste(FICTIONAL_POSTING);
  const extraction = await extractions.persistExtraction(
    candidate.user.id,
    postingId,
    [runInsert()],
    requirements ?? [
      requirementInsert(),
      requirementInsert({
        text: '5+ years TypeScript experience',
        sourceQuote: '5+ years TypeScript experience.',
      }),
    ],
  );
  await profileRepo.syncProfile(candidate.user.id, {
    skills: [
      { name: 'TypeScript', category: 'language', level: 'expert', years: 8, lastUsed: null },
    ],
    experiences: [],
    projects: [],
  });
  const run = extraction.runs[0]!;
  const seeded = extraction.requirements;
  const tsRequirement = seeded[1];
  const outcome = await fitRepo.persistFitReport(
    candidate.user.id,
    postingId,
    run.id,
    reportData(tsRequirement?.id),
    CRITERIA,
    seeded.length >= 2
      ? [
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
        ]
      : [],
  );
  if (review) {
    const reviewed = await instance.inject({
      method: 'POST',
      url: `/fit-reports/${outcome.report.id}/review`,
      headers: candidate.headers,
    });
    expect(reviewed.statusCode).toBe(200);
  }
  return {
    postingId,
    reportId: outcome.report.id,
    requirements: seeded,
    gaps: outcome.gaps,
  };
}

describe('POST /postings/:id/interview-prep — resolution preconditions', () => {
  it('401s without a session and 403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const anonymous = await instance.inject({
      method: 'POST',
      url: '/postings/11111111-1111-4111-8111-111111111111/interview-prep',
    });
    expect(anonymous.statusCode).toBe(401);

    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const crossOrigin = await candidate.draft(postingId, {
      origin: 'https://fictional-evil.example',
    });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it('404s an unknown posting, 409s NO_FIT_REPORT, 409s REPORT_NOT_REVIEWED', async () => {
    const instance = await build({ llmProvider: createMockProvider([]) });
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

  it('a re-score moves the anchor: an unreviewed NEWER report 409s even though the old one was reviewed (decision (a))', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    expect((await candidate.draft(postingId)).statusCode).toBe(201);

    // Re-score: a second (draft) report becomes the posting's latest.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const { runs, requirements } = await extractions.persistExtraction(
      candidate.user.id,
      postingId,
      [runInsert()],
      [requirementInsert()],
    );
    await fitRepo.persistFitReport(
      candidate.user.id,
      postingId,
      runs[0]!.id,
      reportData(),
      CRITERIA,
      [
        {
          requirementId: requirements[0]!.id,
          classification: 'genuine_gap',
          rationale: 'Fictional re-score rationale.',
        },
      ],
    );
    const stale = await candidate.draft(postingId);
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('REPORT_NOT_REVIEWED');
    // And the GET now reflects the NEW report: prep null (the old prep is
    // pinned to the superseded report, never served from the posting view).
    const view = await candidate.getPrep(postingId);
    expect(view.json<InterviewPrepResponse>().prep).toBeNull();
  });

  it('409s NO_VERIFIED_REQUIREMENTS before any paid call — false AND legacy-null both excluded (condition 1)', async () => {
    // An empty mock script makes any provider call throw loudly.
    const instance = await build({ llmProvider: createMockProvider([]) });
    const candidate = await authedCandidate(instance);
    const { postingId, requirements } = await seededReviewedReport(instance, candidate, {
      requirements: [
        requirementInsert({ quoteVerified: false }),
        requirementInsert({ text: 'Legacy fictional requirement', quoteVerified: true }),
      ],
    });
    // Simulate the pre-M1-06 legacy NULL state (the write path only admits
    // booleans): the second requirement was never verified.
    await handle.pool.query(`update requirements set quote_verified = null where id = $1`, [
      requirements[1]!.id,
    ]);
    const refused = await candidate.draft(postingId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('NO_VERIFIED_REQUIREMENTS');
  });
});

describe('POST /postings/:id/interview-prep — drafting', () => {
  it('drafts from the reviewed latest report: 201, typed points, server-anchored badge, R2 run', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId, reportId, gaps } = await seededReviewedReport(instance, candidate);

    const drafted = await candidate.draft(postingId);
    expect(drafted.statusCode).toBe(201);
    const body = drafted.json<InterviewPrepResponse>();
    expect(body.cached).toBe(false);
    expect(body.prep).not.toBeNull();
    expect(body.prep!.fitReportId).toBe(reportId);
    expect(body.prep!.reviewStatus).toBe('draft');
    // R2: the run under the prep is its OWN drafting run.
    expect(body.run!.id).toBeDefined();
    expect(body.run!.status).toBe('ok');
    expect(body.run!.promptId).toBe('interview-prep@v1');

    const [first, second] = body.prep!.questions;
    expect(first!.kind).toBe('technical');
    expect(first!.position).toBe(0);
    expect(first!.requirementText).toBe('Fictional Kubernetes operations requirement');
    // The disclosure point: server-anchored LIVE classification (condition
    // 3) + the read-time pointer, empty = honest "not yet planned".
    expect(first!.points).toHaveLength(1);
    const disclosure = first!.points[0]!;
    expect(disclosure.type).toBe('gap_disclosure');
    if (disclosure.type === 'gap_disclosure') {
      expect(disclosure.gapId).toBe(gaps.find((gap) => gap.classification === 'genuine_gap')!.id);
      expect(disclosure.gapClassification).toBe('genuine_gap');
      expect(disclosure.learningPlans).toEqual([]);
    }
    // The evidence point: joined quote display, no gap fields.
    const evidence = second!.points[0]!;
    expect(evidence.type).toBe('evidence');
    if (evidence.type === 'evidence') {
      expect(evidence.evidenceStrength).toBe('adjacent');
      expect(evidence.evidencePostingQuote).toBe('5+ years TypeScript experience');
      expect(evidence.evidenceProfileQuote).toBe('Shipped a fictional TypeScript platform');
    }

    // The provider saw ONLY the delimited verified structured payload —
    // never the raw posting text (ADR-0006 layer 2; company prose stays
    // out even though requirement strings legitimately travel).
    const sent = JSON.stringify(provider.requests);
    expect(sent).toContain('Fictional Kubernetes operations requirement');
    expect(sent).not.toContain('Fictional Gadget Labs');
  });

  it('serves the existing prep on re-POST: 200, cached, no second LLM call (UNIQUE as cache)', async () => {
    // A one-response script: a second provider call would throw loudly.
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);

    expect((await candidate.draft(postingId)).statusCode).toBe(201);
    const again = await candidate.draft(postingId);
    expect(again.statusCode).toBe(200);
    const body = again.json<InterviewPrepResponse>();
    expect(body.cached).toBe(true);
    expect(body.prep).not.toBeNull();
    expect(provider.requests).toHaveLength(1);
  });

  it('503s when no provider is configured (after the cheap preconditions)', async () => {
    const instance = await build();
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const refused = await candidate.draft(postingId);
    expect(refused.statusCode).toBe(503);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('a schema-failed terminal is a 201 RESULT: run recorded, prep null, GET shows it (failure display)', async () => {
    const provider = createMockProvider([{ text: 'not json' }, { text: 'still not json' }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);

    const drafted = await candidate.draft(postingId);
    expect(drafted.statusCode).toBe(201);
    const body = drafted.json<InterviewPrepResponse>();
    expect(body.prep).toBeNull();
    expect(body.run!.status).toBe('schema_failed');
    expect(body.run!.attempt).toBe(2);

    const view = await candidate.getPrep(postingId);
    const viewed = view.json<InterviewPrepResponse>();
    expect(viewed.prep).toBeNull();
    expect(viewed.run!.status).toBe('schema_failed');
  });
});

describe('POST /postings/:id/interview-prep — tripwires (flag, write nothing)', () => {
  async function draftWith(mockText: string) {
    const provider = createMockProvider([{ text: mockText }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const drafted = await candidate.draft(postingId);
    return { drafted, candidate, postingId };
  }

  async function expectFlaggedNoPrep(mockText: string) {
    const { drafted, candidate, postingId } = await draftWith(mockText);
    expect(drafted.statusCode).toBe(201);
    const body = drafted.json<InterviewPrepResponse>();
    expect(body.prep).toBeNull();
    expect(body.run!.status).toBe('flagged');
    // Nothing reached the DB — the GET failure display shows only the run.
    const view = await candidate.getPrep(postingId);
    expect(view.json<InterviewPrepResponse>().prep).toBeNull();
    const counts = await handle.pool.query<{ preps: string; questions: string; points: string }>(
      `select (select count(*) from interview_preps) as preps,
              (select count(*) from interview_prep_questions) as questions,
              (select count(*) from interview_prep_points) as points`,
    );
    expect(counts.rows[0]).toEqual({ preps: '0', questions: '0', points: '0' });
  }

  it('CITATION: a fabricated requirement ref flags the run with no prep row', async () => {
    await expectFlaggedNoPrep(FABRICATED_REQUIREMENT_DRAFT);
  });

  it("CITATION: evidence cited across requirements (r2's e1 on an r1 question) flags", async () => {
    await expectFlaggedNoPrep(CROSS_BLED_DRAFT);
  });

  it('DISCLOSURE (commission): an obliged question with no gap disclosure flags', async () => {
    await expectFlaggedNoPrep(MISSING_DISCLOSURE_DRAFT);
  });

  it("DISCLOSURE (spurious): a disclosure on the 'have' requirement flags (bidirectional)", async () => {
    await expectFlaggedNoPrep(SPURIOUS_DISCLOSURE_DRAFT);
  });

  it('never logs question, point, quote, or disclosure text (value-free telemetry law)', async () => {
    const lines: string[] = [];
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    // LOG_LEVEL info so the draft's info line actually emits — the positive
    // counter assertions below would be vacuous at the default 'fatal'.
    app = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      llmProvider: provider,
      logStream: { write: (line: string) => void lines.push(line) },
    });
    const instance = app;
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    expect((await candidate.draft(postingId)).statusCode).toBe(201);
    const logged = lines.join('');
    for (const fragment of [
      'How would you approach operating Kubernetes',
      'Be upfront: no production Kubernetes',
      'Speak from the fictional platform work',
      '5+ years TypeScript experience',
      'Shipped a fictional TypeScript platform',
    ]) {
      expect(logged).not.toContain(fragment);
    }
    // ...while the value-free counters DO land.
    expect(logged).toContain('interview prep draft');
    expect(logged).toContain('excludedRequirementCount');
    expect(logged).toContain('spuriousDisclosureCount');
  });
});

describe('GET /postings/:id/interview-prep', () => {
  it('404s an unknown posting; a report-less posting is the EMPTY collection, not an error', async () => {
    const instance = await build();
    const candidate = await authedCandidate(instance);
    const unknown = await candidate.getPrep('11111111-1111-4111-8111-111111111111');
    expect(unknown.statusCode).toBe(404);

    const postingId = await candidate.paste(FICTIONAL_POSTING);
    const empty = await candidate.getPrep(postingId);
    expect(empty.statusCode).toBe(200);
    expect(empty.json<InterviewPrepResponse>()).toEqual({ run: null, prep: null, cached: false });
  });

  it('the learningPlans pointer is computed at READ time: a plan created after drafting appears', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId, gaps } = await seededReviewedReport(instance, candidate);
    expect((await candidate.draft(postingId)).statusCode).toBe(201);

    // A learning plan citing the disclosed gap lands AFTER the draft.
    const gapId = gaps.find((gap) => gap.classification === 'genuine_gap')!.id;
    const persisted = await learningRepo.persistDraftingOutcome(
      candidate.user.id,
      [
        {
          promptId: 'learning-plan@v1',
          provider: 'mock',
          model: 'mock-sonnet',
          rawResponse: { mock: true },
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          latencyMs: 5,
          attempt: 1,
          status: 'ok',
          createdAt: new Date('2026-07-25T12:00:00.000Z'),
        },
      ],
      false,
      {
        title: 'Close the fictional Kubernetes gap',
        gaps: [{ gapId, focus: 'Build a fictional cluster lab.', priority: 'high' }],
      },
    );

    const view = await candidate.getPrep(postingId);
    const disclosure = view.json<InterviewPrepResponse>().prep!.questions[0]!.points[0]!;
    expect(disclosure.type).toBe('gap_disclosure');
    if (disclosure.type === 'gap_disclosure') {
      expect(disclosure.learningPlans).toEqual([
        { id: persisted.planId, title: 'Close the fictional Kubernetes gap' },
      ]);
    }
  });
});

describe('POST /interview-preps/:id/review', () => {
  it('one-shot CAS: 200 with trimmed notes, then 409 PREP_ALREADY_REVIEWED, 404 unknown', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const drafted = await candidate.draft(postingId);
    const prepId = drafted.json<InterviewPrepResponse>().prep!.id;

    const reviewed = await candidate.reviewPrep(prepId, { notes: '  Solid set.  ' });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toEqual({ id: prepId, reviewStatus: 'reviewed', notes: 'Solid set.' });

    const again = await candidate.reviewPrep(prepId, {});
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('PREP_ALREADY_REVIEWED');

    const unknown = await candidate.reviewPrep('11111111-1111-4111-8111-111111111111');
    expect(unknown.statusCode).toBe(404);
  });

  it('a body-less POST reviews with null notes; the reviewed status shows on the wire prep', async () => {
    const provider = createMockProvider([{ text: VALID_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const candidate = await authedCandidate(instance);
    const { postingId } = await seededReviewedReport(instance, candidate);
    const drafted = await candidate.draft(postingId);
    const prepId = drafted.json<InterviewPrepResponse>().prep!.id;

    const reviewed = await candidate.reviewPrep(prepId);
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toEqual({ id: prepId, reviewStatus: 'reviewed', notes: null });

    const view = await candidate.getPrep(postingId);
    expect(view.json<InterviewPrepResponse>().prep!.reviewStatus).toBe('reviewed');
  });
});
