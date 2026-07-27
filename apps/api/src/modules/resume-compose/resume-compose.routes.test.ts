// M6-04 (ADR-0018) compose route/service integration tests, mocked provider.
// Every posting, requirement, and profile row is fictional (RISKS P-01). Laws
// pinned: compose requires a REVIEWED report + a contact row; every gate input
// except the claims is server-derived (the route reads no gate input from the
// client - REQUIRED-1); ANY claim-provenance violation flags the run and writes
// NOTHING (D6 route-level tamper proof, both fabricated-number L2 and
// cross-provenance L4); an empty draft is a distinct 'empty' policy status that
// persists nothing; requirements/gaps never enter the document (D7); revisions
// via redraft supersede-CAS; one-shot review CAS; derived stale flag.
import { type FitReportResumeDocumentResponse, type SearchCriteriaData } from '@careerforge/core';
import {
  createExtractionsRepository,
  createProfileRepository,
  createSearchCriteriaRepository,
  type ExtractionRunInsert,
  type RequirementInsert,
} from '@careerforge/db';
import { createTestDb, resumeHeaderFixture, truncateAllTables } from '@careerforge/db/test-utils';
import { createMockProvider } from '@careerforge/llm';
import { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();
const extractions = createExtractionsRepository(handle.db);
const profileRepo = createProfileRepository(handle.db);
const criteriaRepo = createSearchCriteriaRepository(handle.db);

const CANARY = 'ZZ-POSTING-CANARY-ZZ';
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

// The known small profile fixes the builder's refs: one experience (x1) with one
// bullet (ev1), one personal project (p1) with a description (ev2), one summary
// block (ev3). Ref order: experiences -> their bullets, then projects ->
// descriptions, then summaries (compose-payload.ts).
const BULLET_TEXT = 'Shipped 3 services';
const PROJECT_DESC = 'Built a fictional side project end to end';
const SUMMARY_TEXT = 'Full-stack engineer focused on delivery and reliability';

// Gate-PASSING: an experience claim citing its own bullet ev1 (the number 3 is in
// ev1), and a summary claim citing ev3.
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
// A second gate-passing draft for redraft (distinct text).
const VALID_COMPOSE_2 = JSON.stringify({
  claims: [
    {
      text: 'Delivered 3 services reliably',
      section: 'experience',
      entityRef: 'x1',
      citationRefs: ['ev1'],
    },
  ],
});
// FABRICATED NUMBER (L2): 47 appears in no cited source.
const FABRICATED_NUMBER_COMPOSE = JSON.stringify({
  claims: [
    {
      text: 'Shipped 47 services for the team',
      section: 'experience',
      entityRef: 'x1',
      citationRefs: ['ev1'],
    },
  ],
});
// CROSS-PROVENANCE (L4): an experience claim citing the personal project's ev2.
const CROSS_PROVENANCE_COMPOSE = JSON.stringify({
  claims: [
    {
      text: 'Led delivery of the platform',
      section: 'experience',
      entityRef: 'x1',
      citationRefs: ['ev2'],
    },
  ],
});
const EMPTY_COMPOSE = JSON.stringify({ claims: [] });

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
    text: `Fictional requirement ${CANARY} for coverage`,
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
    email: `compose.${String(userSequence)}.fictional@example.com`,
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
  const compose = (reportId: string, payload?: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/resume-document`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const getDoc = (reportId: string) =>
    instance.inject({ method: 'GET', url: `/fit-reports/${reportId}/resume-document`, headers });
  const redraft = (documentId: string) =>
    instance.inject({ method: 'POST', url: `/resume-documents/${documentId}/redraft`, headers });
  const review = (documentId: string, payload?: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/resume-documents/${documentId}/review`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  return { user, headers, paste, compose, getDoc, redraft, review };
}

async function seededReviewedReport(
  instance: FastifyInstance,
  who: Awaited<ReturnType<typeof authed>>,
  { review = true, withContact = true }: { review?: boolean; withContact?: boolean } = {},
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
  if (review) {
    const reviewed = await instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/review`,
      headers: who.headers,
    });
    expect(reviewed.statusCode).toBe(200);
  }
  if (!withContact) {
    await handle.pool.query('delete from profile_contact where user_id = $1', [who.user.id]);
  }
  return { postingId, reportId };
}

async function countN(text: string, param: string): Promise<number> {
  const result = await handle.pool.query<{ n: number }>(text, [param]);
  return result.rows[0]?.n ?? -1;
}
async function countFor(reportId: string) {
  return {
    documents: await countN(
      'select count(*)::int as n from resume_documents where fit_report_id = $1',
      reportId,
    ),
    claims: await countN(
      'select count(*)::int as n from resume_claims c join resume_documents d on d.id = c.resume_document_id where d.fit_report_id = $1',
      reportId,
    ),
    citations: await countN(
      'select count(*)::int as n from resume_claim_citations rc join resume_claims c on c.id = rc.resume_claim_id join resume_documents d on d.id = c.resume_document_id where d.fit_report_id = $1',
      reportId,
    ),
  };
}

describe('POST /fit-reports/:id/resume-document (compose)', () => {
  it('composes a gate-passing document: 201, claims + citations persisted, then 200 cached', async () => {
    const provider = createMockProvider([{ text: VALID_COMPOSE }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);

    const first = await who.compose(reportId);
    expect(first.statusCode).toBe(201);
    const body = first.json<FitReportResumeDocumentResponse>();
    expect(body.cached).toBe(false);
    expect(body.run?.status).toBe('ok');
    expect(body.document?.revision).toBe(1);
    expect(body.document?.claims.length).toBe(2);
    const counts = await countFor(reportId);
    expect(counts).toEqual({ documents: 1, claims: 2, citations: 2 });

    const second = await who.compose(reportId);
    expect(second.statusCode).toBe(200);
    expect(second.json<FitReportResumeDocumentResponse>().cached).toBe(true);
    expect(provider.requests).toHaveLength(1);

    const got = await who.getDoc(reportId);
    expect(got.json<FitReportResumeDocumentResponse>().document?.stale).toBe(false);
  });

  it('409 REPORT_NOT_REVIEWED on a draft report; 404 for a missing report', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who, { review: false });
    const unreviewed = await who.compose(reportId);
    expect(unreviewed.statusCode).toBe(409);
    expect(unreviewed.json<{ error: { code: string } }>().error.code).toBe('REPORT_NOT_REVIEWED');
    const missing = await who.compose('99999999-9999-4999-8999-999999999999');
    expect(missing.statusCode).toBe(404);
  });

  it('409 PROFILE_INCOMPLETE when no contact row exists', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_COMPOSE }]) });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who, { withContact: false });
    const response = await who.compose(reportId);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('D4: a doctored request body (client-supplied evidence/claims/vocabulary) has ZERO effect', async () => {
    const provider = createMockProvider([{ text: VALID_COMPOSE }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const doctored = await who.compose(reportId, {
      evidence: [
        { ref: 'ev1', sourceText: 'anything', owner: { kind: 'global' }, provenance: null },
      ],
      entities: { experiences: [], projects: [] },
      skillVocabulary: ['whatever'],
      claims: [
        { text: 'client claim', section: 'summary', entityRef: null, citationRefs: ['ev1'] },
      ],
    });
    expect(doctored.statusCode).toBe(201);
    const body = doctored.json<FitReportResumeDocumentResponse>();
    // Identical to a clean compose: the composed claims come ONLY from the mock
    // provider (server-side), never the body; the body fields are not read.
    expect(body.document?.claims.map((c) => c.text)).toEqual([
      'Shipped 3 services for the team',
      'Full-stack engineer focused on delivery',
    ]);
  });

  it('D7: requirement/gap text (a posting canary) never enters the document', async () => {
    const provider = createMockProvider([{ text: VALID_COMPOSE }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const response = await who.compose(reportId);
    expect(response.statusCode).toBe(201);
    expect(JSON.stringify(response.json<FitReportResumeDocumentResponse>())).not.toContain(CANARY);
  });

  it('EMPTY policy: an empty draft records status empty and persists no document', async () => {
    const provider = createMockProvider([{ text: EMPTY_COMPOSE }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const response = await who.compose(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResumeDocumentResponse>();
    expect(body.document).toBeNull();
    expect(body.run?.status).toBe('empty');
    expect((await countFor(reportId)).documents).toBe(0);
  });
});

describe('POST /fit-reports/:id/resume-document tamper-proof (flag, write nothing)', () => {
  it('FABRICATED NUMBER (L2): 201, run flagged, NO document/claims/citations', async () => {
    const provider = createMockProvider([{ text: FABRICATED_NUMBER_COMPOSE }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const response = await who.compose(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResumeDocumentResponse>();
    expect(body.document).toBeNull();
    expect(body.run?.status).toBe('flagged');
    expect(await countFor(reportId)).toEqual({ documents: 0, claims: 0, citations: 0 });
  });

  it('CROSS-PROVENANCE (L4): experience claim citing personal-project evidence -> flagged, write nothing', async () => {
    const provider = createMockProvider([{ text: CROSS_PROVENANCE_COMPOSE }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const response = await who.compose(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResumeDocumentResponse>();
    expect(body.document).toBeNull();
    expect(body.run?.status).toBe('flagged');
    expect(await countFor(reportId)).toEqual({ documents: 0, claims: 0, citations: 0 });
  });
});

describe('redraft + review + stale', () => {
  it('redraft supersedes rev 1 and drafts rev 2; redraft on a superseded id 409s', async () => {
    const provider = createMockProvider([{ text: VALID_COMPOSE }, { text: VALID_COMPOSE_2 }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);

    const first = await who.compose(reportId);
    const doc1 = first.json<FitReportResumeDocumentResponse>().document;
    expect(doc1?.revision).toBe(1);

    const redraft = await who.redraft(doc1!.id);
    expect(redraft.statusCode).toBe(201);
    const doc2 = redraft.json<FitReportResumeDocumentResponse>().document;
    expect(doc2?.revision).toBe(2);
    // The current document is now rev 2.
    const current = await who.getDoc(reportId);
    expect(current.json<FitReportResumeDocumentResponse>().document?.revision).toBe(2);

    // Redrafting the now-superseded rev 1 -> not current.
    const again = await who.redraft(doc1!.id);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('DOCUMENT_NOT_CURRENT');
  });

  it('review CAS: 200 once, 409 already-reviewed, 409 superseded', async () => {
    const provider = createMockProvider([{ text: VALID_COMPOSE }, { text: VALID_COMPOSE_2 }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    const first = await who.compose(reportId);
    const doc1 = first.json<FitReportResumeDocumentResponse>().document!;

    const reviewed = await who.review(doc1.id, { notes: 'Looks honest.' });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json<{ reviewStatus: string }>().reviewStatus).toBe('reviewed');

    const again = await who.review(doc1.id);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('DOCUMENT_ALREADY_REVIEWED');

    // Supersede rev 1 via redraft, then review the superseded rev 1 -> 409.
    const redraft = await who.redraft(doc1.id);
    expect(redraft.statusCode).toBe(201);
    // A fresh draft rev 1 was reviewed; but we superseded it, so it is superseded.
    const superseded = await who.review(doc1.id);
    expect(superseded.statusCode).toBe(409);
    expect(superseded.json<{ error: { code: string } }>().error.code).toBe('DOCUMENT_SUPERSEDED');
  });

  it('derived stale flips true after a profile input postdates the document', async () => {
    const provider = createMockProvider([{ text: VALID_COMPOSE }]);
    const instance = await build({ llmProvider: provider });
    const who = await authed(instance);
    const { reportId } = await seededReviewedReport(instance, who);
    await who.compose(reportId);
    const before = await who.getDoc(reportId);
    expect(before.json<FitReportResumeDocumentResponse>().document?.stale).toBe(false);

    await handle.pool.query(
      "update profile_summaries set updated_at = now() + interval '1 hour' where user_id = $1",
      [who.user.id],
    );
    const after = await who.getDoc(reportId);
    expect(after.json<FitReportResumeDocumentResponse>().document?.stale).toBe(true);
  });
});
