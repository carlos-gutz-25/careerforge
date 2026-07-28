// M6-06 (ADR-0018) ats-coverage route/service integration tests, mocked
// provider. Every posting/requirement/profile row is fictional (RISKS P-01).
// Laws pinned: DRAFT-ALLOWED (coverage is the redraft loop) + superseded-gated
// (409), 404 not-found/not-owned, 500 on a malformed stored snapshot,
// never-trust-the-client (a doctored body has zero effect), value-free logs
// (counts + booleans only), and the end-to-end verdict + honesty string match
// the pure scorer verbatim (the wiring cannot silently diverge).
import {
  canonicalResumeDocSchema,
  type AtsCoverageReport,
  type SearchCriteriaData,
} from '@careerforge/core';
import {
  createExtractionsRepository,
  createProfileRepository,
  createResumeDocumentsRepository,
  createSearchCriteriaRepository,
  type ExtractionRunInsert,
  type RequirementInsert,
} from '@careerforge/db';
import { createTestDb, resumeHeaderFixture, truncateAllTables } from '@careerforge/db/test-utils';
import { createMockProvider } from '@careerforge/llm';
import { ATS_COVERAGE_HONESTY, scoreAtsCoverage } from '@careerforge/scoring';
import { type FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();
const extractions = createExtractionsRepository(handle.db);
const profileRepo = createProfileRepository(handle.db);
const criteriaRepo = createSearchCriteriaRepository(handle.db);

const FICTIONAL_POSTING = [
  'Senior TypeScript Engineer - Fictional Gadget Labs.',
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

const BULLET_TEXT = 'Shipped 3 services';
const PROJECT_DESC = 'Built a fictional side project end to end';
const SUMMARY_TEXT = 'Full-stack engineer focused on delivery and reliability';

const VALID_COMPOSE = JSON.stringify({
  claims: [
    {
      text: 'Shipped 3 services for the team',
      section: 'experience',
      entityRef: 'x1',
      citationRefs: ['ev1'],
    },
    {
      text: 'Full-stack engineer focused on delivery',
      section: 'summary',
      entityRef: null,
      citationRefs: ['ev3'],
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
    createdAt: new Date('2026-07-23T09:00:00.000Z'),
    ...overrides,
  };
}

function requirementInsert(overrides: Partial<RequirementInsert> = {}): RequirementInsert {
  return {
    kind: 'must_have',
    category: 'other',
    text: 'Fictional requirement mentioning TypeScript delivery',
    sourceQuote: 'Requirements: 5+ years TypeScript experience.',
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
async function authed(instance: FastifyInstance) {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `ats.${String(userSequence)}.fictional@example.com`,
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
  const compose = (reportId: string) =>
    instance.inject({ method: 'POST', url: `/fit-reports/${reportId}/resume-document`, headers });
  const atsCoverage = (documentId: string, payload?: unknown) =>
    instance.inject({
      method: 'GET',
      url: `/resume-documents/${documentId}/ats-coverage`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  return { user, headers, paste, compose, atsCoverage };
}

async function seededReport(
  instance: FastifyInstance,
  who: Awaited<ReturnType<typeof authed>>,
  requirements: RequirementInsert[] = [requirementInsert()],
) {
  const postingId = await who.paste(FICTIONAL_POSTING);
  await extractions.persistExtraction(who.user.id, postingId, [runInsert()], requirements);
  await profileRepo.syncProfile(who.user.id, {
    ...resumeHeaderFixture(),
    summaries: [{ text: SUMMARY_TEXT }],
    skills: [
      { name: 'TypeScript', category: 'language', level: 'expert', years: 8, lastUsed: null },
    ],
    experiences: [
      {
        company: 'Fictional Gizmo Works',
        title: 'Senior Software Engineer',
        startDate: '2019-02-01',
        endDate: null,
        bullets: [BULLET_TEXT],
      },
    ],
    projects: [
      {
        name: 'Fictional Side Project',
        company: null,
        provenance: 'personal',
        summary: PROJECT_DESC,
      },
    ],
  });
  await criteriaRepo.upsert(who.user.id, CRITERIA);
  const scored = await instance.inject({
    method: 'POST',
    url: `/postings/${postingId}/fit`,
    headers: who.headers,
  });
  expect(scored.statusCode).toBe(201);
  const reportId = scored.json<{ id: string }>().id;
  const reviewed = await instance.inject({
    method: 'POST',
    url: `/fit-reports/${reportId}/review`,
    headers: who.headers,
  });
  expect(reviewed.statusCode).toBe(200);
  return { reportId };
}

/** Compose a draft document and return its id (mock provider must have a response
 *  queued). Coverage runs on the DRAFT - no review step. */
async function composeDraft(
  who: Awaited<ReturnType<typeof authed>>,
  reportId: string,
): Promise<string> {
  const composed = await who.compose(reportId);
  expect(composed.statusCode).toBe(201);
  return composed.json<{ document: { id: string } }>().document.id;
}

const NOT_A_DOC = '00000000-0000-4000-8000-000000000000';

describe('GET /resume-documents/:id/ats-coverage', () => {
  it('scores a DRAFT (allowed) and matches the pure scorer + honesty verbatim', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReport(instance, who);
    const docId = await composeDraft(who, reportId);

    const res = await who.atsCoverage(docId);
    expect(res.statusCode).toBe(200);
    const body = res.json<AtsCoverageReport>();

    // End-to-end verdict pin: the route reproduces the PURE scorer over the same
    // server-read doc + requirements, with the honesty string added verbatim.
    const repo = createResumeDocumentsRepository(handle.db);
    const row = await repo.getDocumentById(who.user.id, docId);
    if (!row) throw new Error('seeded document missing');
    const doc = canonicalResumeDocSchema.parse(row.canonicalDoc);
    const reqs = await repo.findRequirementsForDocumentReport(who.user.id, row.fitReportId);
    expect(body).toEqual({ ...scoreAtsCoverage(doc, reqs), honesty: ATS_COVERAGE_HONESTY });
    expect(body.honesty).toBe(ATS_COVERAGE_HONESTY);
    expect(body.scorerVersion).toBe(1);
  });

  it('409 SUPERSEDED on a superseded document', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReport(instance, who);
    const docId = await composeDraft(who, reportId);
    await handle.pool.query('update resume_documents set superseded_at = now() where id = $1', [
      docId,
    ]);
    const res = await who.atsCoverage(docId);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('DOCUMENT_SUPERSEDED');
  });

  it('404 on a missing id AND on another user document (not owned)', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const owner = await authed(instance);
    const { reportId } = await seededReport(instance, owner);
    const docId = await composeDraft(owner, reportId);

    expect((await owner.atsCoverage(NOT_A_DOC)).statusCode).toBe(404);
    const stranger = await authed(instance);
    expect((await stranger.atsCoverage(docId)).statusCode).toBe(404);
  });

  it('500 on a malformed stored canonicalDoc (zod at the read boundary)', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReport(instance, who);
    const docId = await composeDraft(who, reportId);
    await handle.pool.query(
      `update resume_documents set canonical_doc = '{"nope":1}'::jsonb where id = $1`,
      [docId],
    );
    const res = await who.atsCoverage(docId);
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('MALFORMED_CANONICAL_DOC');
  });

  it('a doctored request body has ZERO effect - inputs are server-read only (D8a)', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReport(instance, who);
    const docId = await composeDraft(who, reportId);

    const clean = await who.atsCoverage(docId);
    const doctored = await who.atsCoverage(docId, {
      canonicalDoc: { contact: { fullName: 'INJECTED ATTACKER' } },
      requirements: [{ requirementId: 'x', text: 'INJECTED REQUIREMENT' }],
    });
    expect(doctored.statusCode).toBe(200);
    expect(doctored.json()).toEqual(clean.json());
    expect(doctored.rawPayload.toString('utf8')).not.toContain('INJECTED');
  });

  it('logs counts + ok-boolean ONLY - never requirement text, claim text, or tokens (D8b)', async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString('utf8'));
        cb();
      },
    });
    // Build at info level (the shared env is 'fatal' to keep test output quiet).
    app = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      llmProvider: createMockProvider([{ text: VALID_COMPOSE }]),
      logStream,
    });
    const instance = app;
    const who = await authed(instance);
    const { reportId } = await seededReport(instance, who);
    const docId = await composeDraft(who, reportId);
    expect((await who.atsCoverage(docId)).statusCode).toBe(200);

    const atsLog = lines.find((line) => line.includes('resume document ats-coverage scored'));
    expect(atsLog).toBeDefined();
    const parsed = JSON.parse(atsLog as string) as Record<string, unknown>;
    expect(parsed.documentId).toBe(docId);
    expect(typeof parsed.hit).toBe('number');
    expect(typeof parsed.partial).toBe('number');
    expect(typeof parsed.miss).toBe('number');
    expect(typeof parsed.keywordOk).toBe('boolean');
    // Value-free: no requirement/claim text, no tokens, no suggestions.
    expect(atsLog).not.toContain('Fictional requirement');
    expect(atsLog).not.toContain('Shipped');
    expect(atsLog).not.toContain('TypeScript');
  });
});
