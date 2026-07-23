// POST/GET /fit-reports/:id/resume-variant + POST /resume-variants/:id/review
// + GET /resume-variants/:id/export integration tests (M2-10). Every posting,
// requirement, profile row, and criteria value here is fictional (RISKS P-01).
// Laws pinned: tailoring requires a REVIEWED report; verified structured data
// only reaches the provider (no raw posting text); one variant per report
// (200-existing, no force); non-ok terminals are 201 results; a fabricated ref
// AND a non-permutation order each flag the run with NO variant row (the
// demonstrated detection for the spec tripwire); export serves the stored
// markdown byte-for-byte and 409s a draft; no label/reason/quote/markdown text
// ever enters logs.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type FitReportResumeVariantResponse, type SearchCriteriaData } from '@careerforge/core';
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

/** One skill (s1), one experience (e1), no projects — a valid reorder. */
const VALID_TAILORING = JSON.stringify({
  skillOrder: ['s1'],
  projectOrder: [],
  emphases: [
    {
      entityRef: 's1',
      gapRefs: ['g1'],
      emphasis: 'lead',
      reason: 'Emphasized in light of the operations requirement.',
    },
  ],
});

/** Cites an entity ref the payload never contained — the fabrication case. */
const FABRICATED_TAILORING = JSON.stringify({
  skillOrder: ['s1'],
  projectOrder: [],
  emphases: [{ entityRef: 's9', gapRefs: ['g1'], emphasis: 'lead', reason: 'uncited entity.' }],
});

/** Drops the only skill from the order — a non-permutation (omission). */
const NON_PERMUTATION_TAILORING = JSON.stringify({
  skillOrder: [],
  projectOrder: [],
  emphases: [],
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
async function authedTailor(instance: FastifyInstance) {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `tailor.${String(userSequence)}.fictional@example.com`,
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
      url: `/fit-reports/${reportId}/resume-variant`,
      headers: { ...headers, ...extraHeaders },
    });
  const getVariant = (reportId: string) =>
    instance.inject({
      method: 'GET',
      url: `/fit-reports/${reportId}/resume-variant`,
      headers,
    });
  const review = (variantId: string, payload?: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/resume-variants/${variantId}/review`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const exportVariant = (variantId: string) =>
    instance.inject({
      method: 'GET',
      url: `/resume-variants/${variantId}/export`,
      headers,
    });

  return { user, headers, paste, draft, getVariant, review, exportVariant };
}

/** Full fictional chain: posting → ok extraction → profile+criteria → scored
 *  fit report → REVIEWED. Returns the report id. */
async function seededReviewedReport(
  instance: FastifyInstance,
  tailor: Awaited<ReturnType<typeof authedTailor>>,
  { review = true, emptyProfile = false }: { review?: boolean; emptyProfile?: boolean } = {},
) {
  const postingId = await tailor.paste(FICTIONAL_POSTING);
  await extractions.persistExtraction(
    tailor.user.id,
    postingId,
    [runInsert()],
    [requirementInsert()],
  );
  await profileRepo.syncProfile(tailor.user.id, {
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
  await criteriaRepo.upsert(tailor.user.id, CRITERIA);
  const scored = await instance.inject({
    method: 'POST',
    url: `/postings/${postingId}/fit`,
    headers: tailor.headers,
  });
  expect(scored.statusCode).toBe(201);
  const reportId = scored.json<{ id: string }>().id;
  if (review) {
    const reviewed = await instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/review`,
      headers: tailor.headers,
    });
    expect(reviewed.statusCode).toBe(200);
  }
  // Optionally empty the profile AFTER scoring (gaps survive; entityCount → 0).
  if (emptyProfile) {
    await profileRepo.syncProfile(tailor.user.id, { skills: [], experiences: [], projects: [] });
  }
  return { postingId, reportId };
}

describe('POST /fit-reports/:id/resume-variant', () => {
  it('401s without a session and 403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const anonymous = await instance.inject({
      method: 'POST',
      url: '/fit-reports/11111111-1111-4111-8111-111111111111/resume-variant',
    });
    expect(anonymous.statusCode).toBe(401);

    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);
    const crossOrigin = await tailor.draft(reportId, { origin: 'https://fictional-evil.example' });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it('tailors from a reviewed report: 201, variant + ordered entries, verified data only to the provider', async () => {
    const provider = createMockProvider([{ text: VALID_TAILORING }]);
    const instance = await build({ llmProvider: provider });
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);

    const response = await tailor.draft(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResumeVariantResponse>();
    expect(body.cached).toBe(false);
    expect(body.run?.status).toBe('ok');
    expect(body.variant?.reviewStatus).toBe('draft');
    expect(body.variant?.fitReportId).toBe(reportId);
    // The skill entry is emphasized and cites g1 with its requirement fields.
    const skill = body.variant?.entries.find((entry) => entry.section === 'skill');
    expect(skill?.emphasis).toBe('lead');
    expect(skill?.citations[0]?.requirementText).toBe(
      'Fictional Kubernetes operations requirement',
    );
    // The experience is present and never emphasized here.
    expect(body.variant?.entries.some((entry) => entry.section === 'experience')).toBe(true);
    // The rendered markdown snapshot is on the wire and mentions the profile.
    expect(body.variant?.renderedMarkdown).toContain('# Tailored resume variant (draft)');

    // Provider saw verified structured data only — never the raw posting text.
    const request = provider.requests[0];
    const userMessage = request?.messages[0]?.content ?? '';
    expect(userMessage).toContain('Fictional Kubernetes operations requirement');
    expect(userMessage).not.toContain(FICTIONAL_POSTING);
    expect(request?.system).not.toContain('Fictional Kubernetes operations requirement');
  });

  it('serves the existing variant with NO LLM call on a repeat POST (200 cached, UNIQUE-as-cache)', async () => {
    const provider = createMockProvider([{ text: VALID_TAILORING }]);
    const instance = await build({ llmProvider: provider });
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);

    const first = await tailor.draft(reportId);
    expect(first.statusCode).toBe(201);
    const second = await tailor.draft(reportId);
    expect(second.statusCode).toBe(200);
    expect(second.json<FitReportResumeVariantResponse>().cached).toBe(true);
    // Only ONE wire call total.
    expect(provider.requests).toHaveLength(1);
  });

  it('409 REPORT_NOT_REVIEWED on a draft report; 404 one-outcome for missing and foreign', async () => {
    const instance = await build({ llmProvider: createMockProvider([]) });
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor, { review: false });

    const unreviewed = await tailor.draft(reportId);
    expect(unreviewed.statusCode).toBe(409);
    expect(unreviewed.json<{ error: { code: string } }>().error.code).toBe('REPORT_NOT_REVIEWED');

    const missing = await tailor.draft('99999999-9999-4999-8999-999999999999');
    expect(missing.statusCode).toBe(404);
  });

  it('409 NOTHING_TO_TAILOR when the profile has no entities — BEFORE any paid call', async () => {
    const provider = createMockProvider([{ text: VALID_TAILORING }]);
    const instance = await build({ llmProvider: provider });
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor, { emptyProfile: true });

    const response = await tailor.draft(reportId);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOTHING_TO_TAILOR');
    // No paid call happened.
    expect(provider.requests).toHaveLength(0);
  });

  it('503 LLM_NOT_CONFIGURED when no provider is set (but there was something to tailor)', async () => {
    const instance = await build(); // no llmProvider
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);

    const response = await tailor.draft(reportId);
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('FLAGS a fabricated entity ref: 201, run flagged, NO variant (demonstrated detection)', async () => {
    const provider = createMockProvider([{ text: FABRICATED_TAILORING }]);
    const instance = await build({ llmProvider: provider });
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);

    const response = await tailor.draft(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResumeVariantResponse>();
    expect(body.run?.status).toBe('flagged');
    expect(body.variant).toBeNull();
  });

  it('FLAGS a non-permutation order (a dropped skill): 201, run flagged, NO variant', async () => {
    const provider = createMockProvider([
      { text: NON_PERMUTATION_TAILORING },
      { text: NON_PERMUTATION_TAILORING },
    ]);
    const instance = await build({ llmProvider: provider });
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);

    const response = await tailor.draft(reportId);
    expect(response.statusCode).toBe(201);
    const body = response.json<FitReportResumeVariantResponse>();
    expect(body.run?.status).toBe('flagged');
    expect(body.variant).toBeNull();
  });

  it('502 LLM_UPSTREAM_ERROR when the provider is down — the audit run persists', async () => {
    const provider = createMockProvider([]); // any call rejects
    const instance = await build({ llmProvider: provider });
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);

    const response = await tailor.draft(reportId);
    expect(response.statusCode).toBe(502);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('LLM_UPSTREAM_ERROR');
    // The value-free error run row is recorded and served by the GET.
    const latest = await tailor.getVariant(reportId);
    const body = latest.json<FitReportResumeVariantResponse>();
    expect(body.variant).toBeNull();
    expect(body.run?.status).toBe('error');
  });
});

describe('GET /fit-reports/:id/resume-variant', () => {
  it('returns variant-null before any draft, then the variant after', async () => {
    const provider = createMockProvider([{ text: VALID_TAILORING }]);
    const instance = await build({ llmProvider: provider });
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);

    const before = await tailor.getVariant(reportId);
    expect(before.statusCode).toBe(200);
    expect(before.json<FitReportResumeVariantResponse>().variant).toBeNull();

    await tailor.draft(reportId);
    const after = await tailor.getVariant(reportId);
    expect(after.json<FitReportResumeVariantResponse>().variant?.fitReportId).toBe(reportId);
  });

  it('404s a missing report', async () => {
    const instance = await build();
    const tailor = await authedTailor(instance);
    const missing = await tailor.getVariant('99999999-9999-4999-8999-999999999999');
    expect(missing.statusCode).toBe(404);
  });
});

describe('POST /resume-variants/:id/review + GET /resume-variants/:id/export', () => {
  async function draftedVariant(instance: FastifyInstance) {
    const tailor = await authedTailor(instance);
    const { reportId } = await seededReviewedReport(instance, tailor);
    const draft = await tailor.draft(reportId);
    const variantId = draft.json<FitReportResumeVariantResponse>().variant?.id;
    if (!variantId) throw new Error('draft produced no variant');
    return { tailor, reportId, variantId };
  }

  it('reviews once (200 CAS), 409s the second, 404s the unknown', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_TAILORING }]) });
    const { tailor, variantId } = await draftedVariant(instance);

    const first = await tailor.review(variantId, { notes: 'Looks honest.' });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ reviewStatus: string; notes: string }>().reviewStatus).toBe('reviewed');

    const again = await tailor.review(variantId);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('VARIANT_ALREADY_REVIEWED');

    const missing = await tailor.review('99999999-9999-4999-8999-999999999999');
    expect(missing.statusCode).toBe(404);
  });

  it('export 409s a draft variant, then serves the stored markdown byte-for-byte once reviewed', async () => {
    const instance = await build({ llmProvider: createMockProvider([{ text: VALID_TAILORING }]) });
    const { tailor, reportId, variantId } = await draftedVariant(instance);

    // Draft: export refused.
    const draftExport = await tailor.exportVariant(variantId);
    expect(draftExport.statusCode).toBe(409);
    expect(draftExport.json<{ error: { code: string } }>().error.code).toBe('VARIANT_NOT_REVIEWED');

    await tailor.review(variantId);

    // The stored snapshot, read via the GET, is what export must serve verbatim.
    const stored = await tailor.getVariant(reportId);
    const renderedMarkdown =
      stored.json<FitReportResumeVariantResponse>().variant?.renderedMarkdown;
    expect(renderedMarkdown).toBeDefined();

    const reviewedExport = await tailor.exportVariant(variantId);
    expect(reviewedExport.statusCode).toBe(200);
    expect(reviewedExport.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(reviewedExport.headers['content-disposition']).toBe(
      `attachment; filename="resume-variant-${variantId}.md"`,
    );
    // Body is RAW markdown (not a quoted JSON string), byte-for-byte the stored
    // snapshot: it starts with the H1, carries real newlines (not escaped "\n"),
    // and equals what review approved.
    expect(reviewedExport.body).toBe(renderedMarkdown);
    expect(reviewedExport.body.startsWith('# Tailored resume variant (draft)')).toBe(true);
    expect(reviewedExport.body).not.toContain('\\n');
  });
});
