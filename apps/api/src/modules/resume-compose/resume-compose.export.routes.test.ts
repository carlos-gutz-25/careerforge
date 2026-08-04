// M6-05 (ADR-0018) export + parse-audit route/service + getDocumentById repo
// integration tests, mocked provider. Every posting/requirement/profile row is
// fictional (RISKS P-01). Laws pinned: export is reviewed + non-superseded only
// (409 draft vs 409 superseded, distinct codes), server-derived status
// (never-trust-the-client, D9), 404 not-found/not-owned, 500 on a malformed
// stored snapshot, ZERO server file writes (streamed buffers), value-free logs;
// parse-audit is superseded-gated but DRAFT-ALLOWED and returns two separate
// never-merged fidelity results + the honesty string.
import { type SearchCriteriaData } from '@careerforge/core';
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
import { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, type AppDeps } from '../../app.ts';
import {
  buildTestEnv,
  createSessionRow,
  createTestUser,
  ORIGIN_HEADER,
} from '../../test/auth-test-helpers.ts';
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

// Gate-passing compose (an experience claim citing its own bullet ev1; a summary
// claim citing ev3).
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
    text: 'Fictional requirement for coverage',
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
    email: `export.${String(userSequence)}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER };

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
  const review = (documentId: string) =>
    instance.inject({ method: 'POST', url: `/resume-documents/${documentId}/review`, headers });
  const exportDoc = (documentId: string, format: string, payload?: unknown) =>
    instance.inject({
      method: 'GET',
      url: `/resume-documents/${documentId}/export?format=${format}`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const audit = (documentId: string, format: string) =>
    instance.inject({
      method: 'GET',
      url: `/resume-documents/${documentId}/parse-audit?format=${format}`,
      headers,
    });
  return { user, headers, paste, compose, review, exportDoc, audit };
}

async function seededReviewedReport(
  instance: FastifyInstance,
  who: Awaited<ReturnType<typeof authed>>,
) {
  const postingId = await who.paste(FICTIONAL_POSTING);
  await extractions.persistExtraction(who.user.id, postingId, [runInsert()], [requirementInsert()]);
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
 *  queued). */
async function composeDraft(
  who: Awaited<ReturnType<typeof authed>>,
  reportId: string,
): Promise<string> {
  const composed = await who.compose(reportId);
  expect(composed.statusCode).toBe(201);
  const id = composed.json<{ document: { id: string } }>().document.id;
  return id;
}

const NOT_A_DOC = '00000000-0000-4000-8000-000000000000';

describe('getDocumentById (repository, additive)', () => {
  it('returns the row for the owner, undefined for a stranger or a missing id', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const docId = await composeDraft(who, reportId);

    const repo = createResumeDocumentsRepository(handle.db);
    const owned = await repo.getDocumentById(who.user.id, docId);
    expect(owned?.id).toBe(docId);
    expect(owned?.canonicalDoc).toBeTruthy();

    const stranger = await createTestUser(handle, {
      email: 'export.stranger.fictional@example.com',
      password: 'fictional-integration-password',
    });
    expect(await repo.getDocumentById(stranger.id, docId)).toBeUndefined();
    expect(await repo.getDocumentById(who.user.id, NOT_A_DOC)).toBeUndefined();
  });
});

describe('GET /resume-documents/:id/export', () => {
  const CASES = [
    { format: 'pdf', contentType: 'application/pdf', ext: '.pdf', magic: '%PDF-' },
    {
      format: 'docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ext: '.docx',
      magic: 'PK',
    },
    { format: 'markdown', contentType: 'text/markdown; charset=utf-8', ext: '.md', magic: '#' },
    { format: 'plaintext', contentType: 'text/plain; charset=utf-8', ext: '.txt', magic: '' },
    { format: 'json', contentType: 'application/json; charset=utf-8', ext: '.json', magic: '{' },
  ] as const;

  for (const c of CASES) {
    it(`streams a reviewed document as ${c.format} with the right headers + raw body`, async () => {
      const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
      const who = await authed(instance);
      const { reportId } = await seededReviewedReport(instance, who);
      const docId = await composeDraft(who, reportId);
      expect((await who.review(docId)).statusCode).toBe(200);

      const res = await who.exportDoc(docId, c.format);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe(c.contentType);
      const disposition = res.headers['content-disposition'] as string;
      expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9-]+\.[a-z]+"$/);
      expect(disposition.endsWith(`resume${c.ext}"`)).toBe(true);
      expect(res.rawPayload.length).toBeGreaterThan(0);
      if (c.magic)
        expect(res.rawPayload.subarray(0, c.magic.length).toString('latin1')).toBe(c.magic);
    });
  }

  it('409 on a DRAFT document (not reviewed) with the DOCUMENT_NOT_EXPORTABLE code', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const docId = await composeDraft(who, reportId);
    const res = await who.exportDoc(docId, 'pdf');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('DOCUMENT_NOT_EXPORTABLE');
  });

  it('409 on a SUPERSEDED document with the distinct DOCUMENT_SUPERSEDED code', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const docId = await composeDraft(who, reportId);
    expect((await who.review(docId)).statusCode).toBe(200);
    await handle.pool.query('update resume_documents set superseded_at = now() where id = $1', [
      docId,
    ]);
    const res = await who.exportDoc(docId, 'pdf');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('DOCUMENT_SUPERSEDED');
  });

  it('404 on a missing id AND on another user document (not owned)', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const owner = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, owner);
    const docId = await composeDraft(owner, reportId);
    expect((await owner.review(docId)).statusCode).toBe(200);

    expect((await owner.exportDoc(NOT_A_DOC, 'pdf')).statusCode).toBe(404);
    const stranger = await authed(instance);
    expect((await stranger.exportDoc(docId, 'pdf')).statusCode).toBe(404);
  });

  it('500 on a malformed stored canonicalDoc (zod at the read boundary)', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const docId = await composeDraft(who, reportId);
    expect((await who.review(docId)).statusCode).toBe(200);
    await handle.pool.query(
      `update resume_documents set canonical_doc = '{"nope":1}'::jsonb where id = $1`,
      [docId],
    );
    const res = await who.exportDoc(docId, 'pdf');
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('MALFORMED_CANONICAL_DOC');
  });

  it('a doctored request body has ZERO effect - the render is server-read only (D9)', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const docId = await composeDraft(who, reportId);
    expect((await who.review(docId)).statusCode).toBe(200);

    const clean = await who.exportDoc(docId, 'json');
    const doctored = await who.exportDoc(docId, 'json', {
      canonicalDoc: { contact: { fullName: 'INJECTED ATTACKER' } },
      claims: [{ text: 'INJECTED CLAIM' }],
    });
    expect(doctored.statusCode).toBe(200);
    expect(doctored.rawPayload.equals(clean.rawPayload)).toBe(true);
    expect(doctored.rawPayload.toString('utf8')).not.toContain('INJECTED');
  });
});

describe('GET /resume-documents/:id/parse-audit', () => {
  it('returns the two never-merged fidelity results + the honesty string on a DRAFT (allowed)', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const docId = await composeDraft(who, reportId); // NOT reviewed - draft allowed

    for (const format of ['pdf', 'docx'] as const) {
      const res = await who.audit(docId, format);
      expect(res.statusCode).toBe(200);
      const report = res.json<{
        parseIntegrity: { ok: boolean };
        evidenceIntegrity: { ok: boolean };
        honesty: string;
      }>();
      expect(report.parseIntegrity.ok).toBe(true);
      expect(report.evidenceIntegrity.ok).toBe(true);
      expect(report.honesty).toContain('not a prediction of any real ATS');
    }
  });

  it('409 SUPERSEDED on a superseded document; 404 on missing', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const docId = await composeDraft(who, reportId);
    await handle.pool.query('update resume_documents set superseded_at = now() where id = $1', [
      docId,
    ]);
    const res = await who.audit(docId, 'pdf');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('DOCUMENT_SUPERSEDED');
    expect((await who.audit(NOT_A_DOC, 'pdf')).statusCode).toBe(404);
  });

  it('400 on an unknown format (the enum boundary)', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const docId = await composeDraft(who, reportId);
    expect((await who.audit(docId, 'markdown')).statusCode).toBe(400);
  });
});
