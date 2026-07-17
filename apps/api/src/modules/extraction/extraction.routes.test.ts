// POST /postings/:id/extract + GET /postings/:id/requirements integration
// tests (M1-05). Every posting and requirement here is fictional. The laws
// pinned here: every wire call persists an extraction_runs row (retries =
// two rows), an ok run's requirements are committed with it, the cache
// serves without a provider call, posting text / sourceQuote / raw provider
// responses never enter logs, and rawText never appears on this surface.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { createMockProvider, type LlmProvider, type MockProvider } from '@careerforge/llm';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();

const FICTIONAL_POSTING = [
  'Senior Software Engineer — Fictional Widgets Inc.',
  'Requirements: 5+ years TypeScript. Nice to have: Fastify.',
].join('\n');

const VALID_OUTPUT = JSON.stringify({
  requirements: [
    {
      kind: 'must_have',
      category: 'language',
      text: 'TypeScript experience',
      sourceQuote: '5+ years TypeScript',
      confidence: 0.95,
    },
    {
      kind: 'nice_to_have',
      category: 'framework',
      text: 'Fastify familiarity',
      sourceQuote: 'Nice to have: Fastify',
      confidence: 0.8,
    },
  ],
});

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
async function authedExtractor(instance: FastifyInstance) {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `extractor.${userSequence}.fictional@example.com`,
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
  const extract = (id: string, payload?: unknown, extraHeaders: Record<string, string> = {}) =>
    instance.inject({
      method: 'POST',
      url: `/postings/${id}/extract`,
      headers: { ...headers, ...extraHeaders },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const requirements = (id: string) =>
    instance.inject({ method: 'GET', url: `/postings/${id}/requirements`, headers });
  const patch = (id: string, payload: unknown) =>
    instance.inject({
      method: 'PATCH',
      url: `/postings/${id}`,
      headers,
      payload: payload as Record<string, unknown>,
    });
  const detailStatus = async (id: string) => {
    const response = await instance.inject({ method: 'GET', url: `/postings/${id}`, headers });
    return response.json<{ status: string }>().status;
  };
  return { user, paste, extract, requirements, patch, detailStatus };
}

async function runRows(postingId: string) {
  const { rows } = await handle.pool.query<{ status: string; attempt: number }>(
    'select status, attempt from extraction_runs where posting_id = $1 order by attempt',
    [postingId],
  );
  return rows;
}

const anyString = expect.any(String) as string;
const anyNumber = expect.any(Number) as number;

const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

function mockedOk(): MockProvider {
  return createMockProvider([{ text: VALID_OUTPUT }]);
}

describe('POST /postings/:id/extract', () => {
  it('401s without a session and 403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build({ llmProvider: mockedOk() });
    const anonymous = await instance.inject({
      method: 'POST',
      url: `/postings/${MISSING_UUID}/extract`,
    });
    expect(anonymous.statusCode).toBe(401);

    const { paste, extract } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);
    const foreign = await extract(id, undefined, { origin: 'https://evil.example.com' });
    expect(foreign.statusCode).toBe(403);
  });

  it('400s a malformed id value-free and 404s unknown/foreign postings identically', async () => {
    const instance = await build({ llmProvider: mockedOk() });
    const owner = await authedExtractor(instance);
    const other = await authedExtractor(instance);
    const id = await owner.paste(FICTIONAL_POSTING);

    const malformed = await owner.extract('FICTIONAL-BAD-ID-77aa');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('FICTIONAL-BAD-ID-77aa');

    const missing = await owner.extract(MISSING_UUID);
    const foreign = await other.extract(id);
    expect(missing.statusCode).toBe(404);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json());
  });

  it('409s an archived posting — out of the pipeline until unarchived', async () => {
    const instance = await build({ llmProvider: mockedOk() });
    const { paste, extract, patch } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);
    await patch(id, { status: 'archived' });

    const response = await extract(id);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('POSTING_ARCHIVED');
    expect(await runRows(id)).toEqual([]);
  });

  it('503s LLM_NOT_CONFIGURED when no provider is wired (keyless boot) — before any spend', async () => {
    const instance = await build(); // no llmProvider; buildTestEnv has no key
    const { paste, extract } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);

    const response = await extract(id);
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('LLM_NOT_CONFIGURED');
    expect(await runRows(id)).toEqual([]);
  });

  it('201-creates a fresh ok run: exact wire shape (usage on the wire, no rawResponse/userId), posting flips to extracted', async () => {
    const instance = await build({ llmProvider: mockedOk() });
    const { paste, extract, detailStatus } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);

    const response = await extract(id);
    expect(response.statusCode).toBe(201);
    // toEqual is exact: a stray rawResponse/userId/postingId/updatedAt on the
    // wire — the serializer NOT stripping undeclared fields — fails this.
    expect(response.json()).toEqual({
      run: {
        id: anyString,
        promptId: 'extract-requirements@v1',
        provider: 'mock',
        model: 'mock-model',
        status: 'ok',
        attempt: 1,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        latencyMs: anyNumber,
        createdAt: anyString,
      },
      requirements: [
        {
          id: anyString,
          kind: 'must_have',
          category: 'language',
          text: 'TypeScript experience',
          sourceQuote: '5+ years TypeScript',
          quoteVerified: null,
          confidence: 0.95,
        },
        {
          id: anyString,
          kind: 'nice_to_have',
          category: 'framework',
          text: 'Fastify familiarity',
          sourceQuote: 'Nice to have: Fastify',
          quoteVerified: null,
          confidence: 0.8,
        },
      ],
      cached: false,
    });
    expect(await detailStatus(id)).toBe('extracted');
  });

  it('a schema-failure retry persists TWO run rows; requirements FK the second', async () => {
    const provider = createMockProvider([{ text: 'not json at all' }, { text: VALID_OUTPUT }]);
    const instance = await build({ llmProvider: provider });
    const { paste, extract } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);

    const response = await extract(id);
    expect(response.statusCode).toBe(201);
    expect(response.json<{ run: { attempt: number } }>().run.attempt).toBe(2);
    expect(provider.requests).toHaveLength(2);
    expect(await runRows(id)).toEqual([
      { status: 'schema_failed', attempt: 1 },
      { status: 'ok', attempt: 2 },
    ]);
  });

  it('terminal schema_failed is a 201 result (both rows persisted, no requirements, no flip)', async () => {
    const provider = createMockProvider([{ text: 'bad' }, { text: 'still bad' }]);
    const instance = await build({ llmProvider: provider });
    const { paste, extract, detailStatus } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);

    const response = await extract(id);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      run: { status: 'schema_failed', attempt: 2 },
      requirements: [],
      cached: false,
    });
    expect(await runRows(id)).toHaveLength(2);
    expect(await detailStatus(id)).toBe('new');
  });

  it('refusal and max_tokens never retry: one provider call, one persisted row, 201 with the status', async () => {
    for (const [stopReason, status] of [
      ['refusal', 'refusal'],
      ['max_tokens', 'max_tokens'],
    ] as const) {
      const provider = createMockProvider([{ text: '', stopReason }]);
      const instance = await build({ llmProvider: provider });
      const { paste, extract } = await authedExtractor(instance);
      const id = await paste(`${FICTIONAL_POSTING} ${stopReason} variant`);

      const response = await extract(id);
      expect(response.statusCode).toBe(201);
      expect(response.json<{ run: { status: string } }>().run.status).toBe(status);
      expect(provider.requests).toHaveLength(1);
      expect(await runRows(id)).toEqual([{ status, attempt: 1 }]);
      await instance.close();
    }
  });

  it('a thrown provider error persists a value-free error row and surfaces 502', async () => {
    const provider: LlmProvider = {
      name: 'anthropic',
      generate: () => Promise.reject(new Error('fictional network failure')),
    };
    const instance = await build({ llmProvider: provider });
    const { paste, extract } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);

    const response = await extract(id);
    expect(response.statusCode).toBe(502);
    expect(response.json<{ error: { code: string; message: string } }>().error.code).toBe(
      'LLM_UPSTREAM_ERROR',
    );
    // Value-free: the upstream error NAME only, never its message.
    expect(response.body).not.toContain('fictional network failure');
    expect(await runRows(id)).toEqual([{ status: 'error', attempt: 1 }]);
  });

  it('serves the second POST from the run cache: 200, cached: true, NO provider call; force appends a fresh run', async () => {
    const provider = createMockProvider([{ text: VALID_OUTPUT }, { text: VALID_OUTPUT }]);
    const instance = await build({ llmProvider: provider });
    const { paste, extract } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);

    const first = await extract(id);
    expect(first.statusCode).toBe(201);
    expect(provider.requests).toHaveLength(1);
    const firstRun = first.json<{ run: { id: string } }>().run;

    const cachedResponse = await extract(id);
    expect(cachedResponse.statusCode).toBe(200);
    expect(cachedResponse.json<{ cached: boolean; run: { id: string } }>()).toMatchObject({
      cached: true,
      run: { id: firstRun.id },
    });
    // The mock records every call — an unchanged count IS the no-call proof
    // (script exhaustion would also reject loudly).
    expect(provider.requests).toHaveLength(1);

    const forced = await extract(id, { force: true });
    expect(forced.statusCode).toBe(201);
    expect(provider.requests).toHaveLength(2);
    expect(await runRows(id)).toHaveLength(2); // append-only run ledger
  });

  it('a body-less POST works (force defaults to false)', async () => {
    const instance = await build({ llmProvider: mockedOk() });
    const { paste, extract } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);

    const response = await extract(id); // no payload at all
    expect(response.statusCode).toBe(201);
  });

  it('never logs posting text, requirement text, sourceQuote, or the raw provider response', async () => {
    const marker = 'FICTIONAL-EXTRACT-CANARY-3f7b';
    const quoteMarker = 'FICTIONAL-QUOTE-CANARY-9d1e';
    const provider = createMockProvider([
      {
        text: JSON.stringify({
          requirements: [
            {
              kind: 'must_have',
              category: 'other',
              text: `requirement mentioning ${quoteMarker}`,
              sourceQuote: `${quoteMarker} verbatim from the posting`,
              confidence: 0.9,
            },
          ],
        }),
        raw: { echoed_posting: `${marker} raw response can embed posting text` },
      },
    ]);
    const infoLines: string[] = [];
    const instance = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      llmProvider: provider,
      logStream: { write: (line) => infoLines.push(line) },
    });
    app = instance;
    const { paste, extract, requirements } = await authedExtractor(instance);
    const id = await paste(`${marker} fictional posting body with ${quoteMarker}`);

    expect((await extract(id)).statusCode).toBe(201);
    expect((await requirements(id)).statusCode).toBe(200);

    expect(infoLines.some((line) => line.includes('extraction run persisted'))).toBe(true);
    for (const line of infoLines) {
      expect(line).not.toContain(marker);
      expect(line).not.toContain(quoteMarker);
    }
  });
});

describe('GET /postings/:id/requirements', () => {
  it('401s without a session and 404s unknown/foreign postings', async () => {
    const instance = await build({ llmProvider: mockedOk() });
    const anonymous = await instance.inject({
      method: 'GET',
      url: `/postings/${MISSING_UUID}/requirements`,
    });
    expect(anonymous.statusCode).toBe(401);

    const owner = await authedExtractor(instance);
    const other = await authedExtractor(instance);
    const id = await owner.paste(FICTIONAL_POSTING);
    expect((await owner.requirements(MISSING_UUID)).statusCode).toBe(404);
    expect((await other.requirements(id)).statusCode).toBe(404);
  });

  it('returns run: null before the first successful extraction (empty collection, not 404)', async () => {
    const provider = createMockProvider([{ text: 'bad' }, { text: 'still bad' }]);
    const instance = await build({ llmProvider: provider });
    const { paste, extract, requirements } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);

    expect((await requirements(id)).json()).toEqual({ run: null, requirements: [] });

    // A terminal schema_failed run still leaves the collection empty.
    await extract(id);
    expect((await requirements(id)).json()).toEqual({ run: null, requirements: [] });
  });

  it('returns the latest ok run with requirements in model output order', async () => {
    const instance = await build({ llmProvider: mockedOk() });
    const { paste, extract, requirements } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);
    await extract(id);

    const response = await requirements(id);
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      run: { status: string } | null;
      requirements: { text: string }[];
    }>();
    expect(body.run?.status).toBe('ok');
    expect(body.requirements.map((r) => r.text)).toEqual([
      'TypeScript experience',
      'Fastify familiarity',
    ]);
    // No rawText key anywhere on this surface (the wire-path law).
    expect(response.body).not.toContain('rawText');
  });
});

describe('unarchive restores the artifact-derived status (M1-02 park, resolved)', () => {
  it('extract → archive → PATCH new restores extracted, not new', async () => {
    const instance = await build({ llmProvider: mockedOk() });
    const { paste, extract, patch } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);
    await extract(id);

    expect((await patch(id, { status: 'archived' })).statusCode).toBe(200);
    const restored = await patch(id, { status: 'new' });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ status: string }>().status).toBe('extracted');
  });

  it('without an ok run, unarchive still restores new (schema_failed leaves no artifact)', async () => {
    const provider = createMockProvider([{ text: 'bad' }, { text: 'still bad' }]);
    const instance = await build({ llmProvider: provider });
    const { paste, extract, patch } = await authedExtractor(instance);
    const id = await paste(FICTIONAL_POSTING);
    await extract(id); // terminal schema_failed — no artifact

    await patch(id, { status: 'archived' });
    const restored = await patch(id, { status: 'new' });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ status: string }>().status).toBe('new');
  });
});
