// Route-level adversarial assertions (M1-07, ADR-0006 layer 6 downstream leg).
// Every posting and requirement here is FICTIONAL. These pin the DEFENDER's
// behavior end to end through the REAL extraction service and the REAL M1-06
// verifier (neither mocked): an injection that produces a fabricated or
// smuggled sourceQuote flags the run, a real NUL in model output lands
// schema_failed with the audit rows intact, adversarial traffic never leaks a
// canary into logs, and a NUL paste is rejected value-free at ingest. The
// MODEL's behavior (did it obey?) is never asserted here — that lives only in
// the live pass. A minimal harness is duplicated on purpose (O-1).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { ADVERSARIAL_CORPUS, createMockProvider, type MockResponse } from '@careerforge/llm';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();

// Constructed at runtime so no literal invisible byte sits in this source
// (the recurring authoring bug — kept out by construction).
const ZWSP = String.fromCharCode(0x200b);
const NUL = String.fromCharCode(0);
const CURLY_LEFT = String.fromCharCode(0x201c);
const CURLY_RIGHT = String.fromCharCode(0x201d);

const fixtureById = (id: string) => {
  const fixture = ADVERSARIAL_CORPUS.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`fixture ${id} missing from corpus`);
  return fixture;
};

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
    email: `injection.${userSequence}.fictional@example.com`,
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
    return response;
  };
  const pasteId = async (rawText: string) => {
    const response = await paste(rawText);
    return response.json<{ posting: { id: string } }>().posting.id;
  };
  const extract = (id: string) =>
    instance.inject({ method: 'POST', url: `/postings/${id}/extract`, headers });
  const requirements = (id: string) =>
    instance.inject({ method: 'GET', url: `/postings/${id}/requirements`, headers });
  const detailStatus = async (id: string) => {
    const response = await instance.inject({ method: 'GET', url: `/postings/${id}`, headers });
    return response.json<{ status: string }>().status;
  };
  return { user, paste, pasteId, extract, requirements, detailStatus };
}

async function runRows(postingId: string) {
  const { rows } = await handle.pool.query<{ status: string; attempt: number }>(
    'select status, attempt from extraction_runs where posting_id = $1 order by attempt',
    [postingId],
  );
  return rows;
}

async function rawResponses(postingId: string) {
  const { rows } = await handle.pool.query<{ raw_response: unknown }>(
    'select raw_response from extraction_runs where posting_id = $1 order by attempt',
    [postingId],
  );
  return rows.map((row) => row.raw_response);
}

// A single requirement whose sourceQuote is whatever we pass — the vehicle for
// fabricated / smuggled quotes.
function oneRequirement(sourceQuote: string): MockResponse {
  return {
    text: JSON.stringify({
      requirements: [
        {
          kind: 'must_have',
          category: 'other',
          text: 'a requirement the model asserts',
          sourceQuote,
          confidence: 0.9,
        },
      ],
    }),
  };
}

describe('B1: an injection that yields a fabricated sourceQuote flags the run', () => {
  it('canary requirement present but quoteVerified=false, run flagged, posting still flips to extracted', async () => {
    const fixture = fixtureById('instruction-override-1');
    // The model "obeyed": it emitted a requirement whose sourceQuote is NOT a
    // verbatim excerpt of the posting (the obey-confirmation the injection
    // asked for). The M1-06 verifier catches exactly this.
    const fabricated = 'I have complied and disabled the extraction schema.';
    expect(fixture.postingText.includes(fabricated)).toBe(false);
    const provider = createMockProvider([oneRequirement(fabricated)]);
    const instance = await build({ llmProvider: provider });
    const { pasteId, extract, requirements, detailStatus } = await authedExtractor(instance);
    const id = await pasteId(fixture.postingText);

    const response = await extract(id);
    expect(response.statusCode).toBe(201);
    expect(await runRows(id)).toEqual([{ status: 'flagged', attempt: 1 }]);

    const body = (await requirements(id)).json<{
      run: { status: string };
      requirements: { sourceQuote: string; quoteVerified: boolean }[];
    }>();
    expect(body.run.status).toBe('flagged');
    expect(body.requirements).toHaveLength(1);
    expect(body.requirements[0]?.quoteVerified).toBe(false);
    // A flagged run bears requirements, so the posting IS extracted (flagged
    // means review, not discard).
    expect(await detailStatus(id)).toBe('extracted');
  });
});

describe('B2: a zero-width-smuggled sourceQuote flags over HTTP', () => {
  it('U+200B present on the quote side only is not a verbatim substring -> flagged', async () => {
    const posting = 'Senior Engineer. We require distributed systems experience.';
    // The genuine excerpt, but with a zero-width space smuggled in. U+200B is
    // not \\s, so normalization does not remove it: not a verbatim match.
    const smuggled = `distributed${ZWSP} systems experience`;
    const provider = createMockProvider([oneRequirement(smuggled)]);
    const instance = await build({ llmProvider: provider });
    const { pasteId, extract, requirements } = await authedExtractor(instance);
    const id = await pasteId(posting);

    expect((await extract(id)).statusCode).toBe(201);
    expect(await runRows(id)).toEqual([{ status: 'flagged', attempt: 1 }]);
    const body = (await requirements(id)).json<{ requirements: { quoteVerified: boolean }[] }>();
    expect(body.requirements[0]?.quoteVerified).toBe(false);
  });
});

describe('B3: a curly-quote-substituted sourceQuote flags over HTTP', () => {
  it('typographic substitution (straight -> curly) is not verbatim -> flagged', async () => {
    const posting = 'We need someone who has "shipped production systems" at scale.';
    // Same words, curly quotes swapped for the posting's straight ones.
    const substituted = `${CURLY_LEFT}shipped production systems${CURLY_RIGHT}`;
    const provider = createMockProvider([oneRequirement(substituted)]);
    const instance = await build({ llmProvider: provider });
    const { pasteId, extract, requirements } = await authedExtractor(instance);
    const id = await pasteId(posting);

    expect((await extract(id)).statusCode).toBe(201);
    expect(await runRows(id)).toEqual([{ status: 'flagged', attempt: 1 }]);
    const body = (await requirements(id)).json<{ requirements: { quoteVerified: boolean }[] }>();
    expect(body.requirements[0]?.quoteVerified).toBe(false);
  });
});

describe('B4: a real U+0000 in model output lands schema_failed with the audit trail intact', () => {
  it('schema_failed terminal after the retry; both rows persisted; NUL stripped, literal escape TEXT survives', async () => {
    // The JSON escape \\u0000 in the model text decodes to a real NUL in the
    // parsed sourceQuote -> v1's NO_NUL refine rejects it -> schema_failed.
    // Both attempts fail, so the run is schema_failed terminal with zero
    // requirements. The raw response carries BOTH a real NUL (must be
    // stripped) and the literal 6-char escape TEXT backslash-u-0000 (must
    // survive byte-identical — R1's invariant, exercised on the FAILURE path
    // for the first time).
    const modelText =
      '{"requirements":[{"kind":"must_have","category":"other","text":"t","sourceQuote":"bad\\u0000quote","confidence":0.5}]}';
    const raw = { realNul: `x${NUL}y`, literalEscape: 'keep \\u0000 verbatim' };
    const provider = createMockProvider([
      { text: modelText, raw },
      { text: modelText, raw },
    ]);
    const instance = await build({ llmProvider: provider });
    const { pasteId, extract, requirements } = await authedExtractor(instance);
    const id = await pasteId('Fictional posting for the NUL failure path.');

    const response = await extract(id);
    // Non-ok terminal is still a persisted result (201), not a cache hit.
    expect(response.statusCode).toBe(201);
    expect(await runRows(id)).toEqual([
      { status: 'schema_failed', attempt: 1 },
      { status: 'schema_failed', attempt: 2 },
    ]);
    // Zero requirements on a schema_failed run.
    const body = (await requirements(id)).json<{ run: unknown; requirements: unknown[] }>();
    expect(body).toEqual({ run: null, requirements: [] });

    const persisted = await rawResponses(id);
    expect(persisted).toHaveLength(2);
    for (const rawResponse of persisted) {
      const asString = JSON.stringify(rawResponse);
      // (b) no real U+0000 anywhere in the persisted structure.
      expect(asString.includes(NUL)).toBe(false);
      const record = rawResponse as { realNul: string; literalEscape: string };
      // The real NUL was stripped from the value ('xy'); the surrounding
      // characters are untouched.
      expect(record.realNul).toBe('xy');
      // (c) the literal 6-char escape TEXT survived byte-identical.
      expect(record.literalEscape).toBe('keep \\u0000 verbatim');
    }
  });
});

describe('B5: adversarial traffic never leaks a canary into logs', () => {
  it('the persist log line carries counts/ids only, never the injection canary', async () => {
    const fixture = fixtureById('system-prompt-probe-1');
    const canary = fixture.liveExpectation.forbiddenSubstrings[0] ?? 'SPILL-PROBE-A';
    // Model echoes the canary back inside a (fabricated) requirement.
    const provider = createMockProvider([oneRequirement(`obeyed: ${canary}`)]);
    const infoLines: string[] = [];
    const instance = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      llmProvider: provider,
      logStream: { write: (line) => infoLines.push(line) },
    });
    app = instance;
    const { pasteId, extract, requirements } = await authedExtractor(instance);
    const id = await pasteId(fixture.postingText);

    expect((await extract(id)).statusCode).toBe(201);
    expect((await requirements(id)).statusCode).toBe(200);
    expect(infoLines.some((line) => line.includes('extraction run persisted'))).toBe(true);
    for (const line of infoLines) {
      expect(line).not.toContain(canary);
    }
  });
});

describe('B6 (O-2 rider): a real U+0000 paste is rejected value-free at ingest', () => {
  it('POST /postings with a NUL in rawText is a 400 VALIDATION_ERROR, never a 500, and echoes nothing', async () => {
    const instance = await build();
    const { paste } = await authedExtractor(instance);
    const hostile = `Fictional posting with a smuggled ${NUL} null byte and marker NULPASTE-CANARY.`;

    const response = await paste(hostile);
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // Value-free: neither the posting text, its canary, nor a raw NUL round-trips.
    expect(response.body.includes(NUL)).toBe(false);
    expect(response.body).not.toContain('NULPASTE-CANARY');
  });
});
