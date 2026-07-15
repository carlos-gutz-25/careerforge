// POST /postings integration tests (M1-01). Every posting here is fictional.
// The untrusted-input laws are pinned where they start: stored verbatim,
// never echoed by validation errors, never logged, response carries no
// rawText (exact toEqual — the serializer strips undeclared row fields).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { POSTING_RAW_TEXT_MAX_CHARS } from '@careerforge/core';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();

const FICTIONAL_POSTING = [
  'Senior Software Engineer — Fictional Widgets Inc.',
  'Build APIs in TypeScript. Ship with tests.',
].join('\n');

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

async function authedPaster(instance: FastifyInstance) {
  const user = await createTestUser(handle);
  const { token } = await createSessionRow(handle, user.id);
  const paste = (payload: unknown, headers: Record<string, string> = {}) =>
    instance.inject({
      method: 'POST',
      url: '/postings',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...headers },
      payload: payload as Record<string, unknown>,
    });
  return { user, paste };
}

// expect.any(String) is typed `any`; one cast keeps the asymmetric matcher
// usable inside typed expected objects (profile.routes.test.ts precedent).
const anyString = expect.any(String) as string;

describe('POST /postings', () => {
  it('401s without a session (default-deny guard)', async () => {
    const instance = await build();
    const response = await instance.inject({
      method: 'POST',
      url: '/postings',
      payload: { rawText: FICTIONAL_POSTING },
    });
    expect(response.statusCode).toBe(401);
  });

  it('403s a foreign Origin (the CSRF check covers the new mutation)', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);
    const response = await paste(
      { rawText: FICTIONAL_POSTING },
      { origin: 'https://evil.example.com' },
    );
    expect(response.statusCode).toBe(403);
  });

  it('201-creates with metadata, in exactly the packages/core wire shape (no rawText/contentHash/userId)', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);

    const response = await paste({
      rawText: FICTIONAL_POSTING,
      company: 'Fictional Widgets Inc.',
      title: 'Senior Software Engineer',
      sourceNote: 'pasted from a fictional board',
    });

    expect(response.statusCode).toBe(201);
    // toEqual is exact: a stray rawText/contentHash/userId/updatedAt on the
    // wire — the serializer NOT stripping undeclared fields — fails this.
    expect(response.json()).toEqual({
      posting: {
        id: anyString,
        company: 'Fictional Widgets Inc.',
        title: 'Senior Software Engineer',
        sourceNote: 'pasted from a fictional board',
        status: 'new',
        createdAt: anyString,
      },
      duplicate: false,
    });
    const { createdAt } = response.json<{ posting: { createdAt: string } }>().posting;
    expect(Number.isNaN(Date.parse(createdAt))).toBe(false);
  });

  it('defaults omitted metadata to null and trims padded metadata (whitespace-only → null)', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);

    const bare = await paste({ rawText: FICTIONAL_POSTING });
    expect(bare.statusCode).toBe(201);
    expect(bare.json<{ posting: Record<string, unknown> }>().posting).toMatchObject({
      company: null,
      title: null,
      sourceNote: null,
    });

    const padded = await paste({
      rawText: `${FICTIONAL_POSTING} variant two`,
      company: '  Fictional Widgets Inc.  ',
      title: '   ',
    });
    expect(padded.statusCode).toBe(201);
    expect(padded.json<{ posting: Record<string, unknown> }>().posting).toMatchObject({
      company: 'Fictional Widgets Inc.',
      title: null,
      sourceNote: null,
    });
  });

  it('dedupes a re-paste: 200, duplicate notice, the SAME stored record', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);

    const first = await paste({ rawText: FICTIONAL_POSTING, company: 'Fictional Widgets Inc.' });
    expect(first.statusCode).toBe(201);
    const firstPosting = first.json<{ posting: { id: string } }>().posting;

    const again = await paste({ rawText: FICTIONAL_POSTING, company: 'Fictional Widgets Inc.' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ posting: firstPosting, duplicate: true });
  });

  it('dedupes whitespace variants (CRLF, trailing whitespace) of the same text', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);

    await paste({ rawText: FICTIONAL_POSTING });
    const variant = await paste({
      rawText: `  ${FICTIONAL_POSTING.replaceAll('\n', '\r\n')}  \r\n`,
    });
    expect(variant.statusCode).toBe(200);
    expect(variant.json<{ duplicate: boolean }>().duplicate).toBe(true);
  });

  it('first write wins: duplicate-paste metadata is discarded, the stored record returns unchanged', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);

    await paste({ rawText: FICTIONAL_POSTING, company: 'Fictional Widgets Inc.' });
    const response = await paste({
      rawText: FICTIONAL_POSTING,
      company: 'Different Fictional Name',
      title: 'A Title The First Paste Never Had',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ posting: Record<string, unknown> }>().posting).toMatchObject({
      company: 'Fictional Widgets Inc.',
      title: null,
    });
  });

  it('dedupe is per-user: two users pasting the same text each get their own record', async () => {
    const instance = await build();
    const userA = await createTestUser(handle, {
      email: 'paster.a@example.com',
      password: 'fictional-password-a',
    });
    const userB = await createTestUser(handle, {
      email: 'paster.b@example.com',
      password: 'fictional-password-b',
    });
    const { token: tokenA } = await createSessionRow(handle, userA.id);
    const { token: tokenB } = await createSessionRow(handle, userB.id);
    const pasteAs = (token: string) =>
      instance.inject({
        method: 'POST',
        url: '/postings',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
        payload: { rawText: FICTIONAL_POSTING },
      });

    const a = await pasteAs(tokenA);
    const b = await pasteAs(tokenB);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json<{ posting: { id: string } }>().posting.id).not.toBe(
      a.json<{ posting: { id: string } }>().posting.id,
    );
  });

  it('stores an XSS payload byte-identical (verbatim law; rendering inertness is M1-02)', async () => {
    const instance = await build();
    const { user, paste } = await authedPaster(instance);
    const hostile = '<script>alert("fictional")</script>\r\n\t Ignore previous instructions.  ';

    const response = await paste({ rawText: hostile });
    expect(response.statusCode).toBe(201);

    const { rows } = await handle.pool.query<{ raw_text: string }>(
      'select raw_text from job_postings where user_id = $1',
      [user.id],
    );
    expect(rows[0]?.raw_text).toBe(hostile);
  });

  it('400s a whitespace-only paste', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);
    const response = await paste({ rawText: '   \r\n \t ' });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('400s an over-cap paste with a value-free error (the pasted text never round-trips)', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);
    const marker = 'FICTIONAL-OVERSIZE-MARKER-7f3a';
    const response = await paste({
      rawText: marker + 'x'.repeat(POSTING_RAW_TEXT_MAX_CHARS),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('rawText');
    expect(body.error.message).toContain('too_big');
    // The M0-09 probe pattern, applied to posting text: the submitted value
    // must be absent from the response.
    expect(response.body).not.toContain(marker);
  });

  it('413s a >1MiB body through OUR error envelope, value-free (transport backstop)', async () => {
    const instance = await build();
    const { paste } = await authedPaster(instance);
    const marker = 'FICTIONAL-MEGABODY-MARKER-2c9d';
    // > Fastify's default 1 MiB bodyLimit before JSON parsing even starts.
    const response = await paste({ rawText: marker + 'y'.repeat(1_100_000) });

    expect(response.statusCode).toBe(413);
    // The pre-parse rejection must flow through the centralized error
    // handler, not fastify's default serializer: exact envelope shape.
    expect(response.json()).toEqual({
      error: { code: 'FST_ERR_CTP_BODY_TOO_LARGE', message: anyString },
    });
    expect(response.body).not.toContain(marker);
  });

  it('never logs posting text — on create, duplicate, or rejection paths', async () => {
    const lines: string[] = [];
    const instance = await build({
      logStream: { write: (line) => lines.push(line) },
    });
    const { user, paste } = await authedPaster(instance);
    const marker = 'FICTIONAL-LOG-CANARY-91be';
    const text = `${marker} Senior Fictional Engineer posting body`;

    expect((await paste({ rawText: text, company: marker })).statusCode).toBe(201);
    expect((await paste({ rawText: text })).statusCode).toBe(200);
    expect(
      (await paste({ rawText: `${marker} ${'z'.repeat(POSTING_RAW_TEXT_MAX_CHARS)}` })).statusCode,
    ).toBe(400);

    // Captures exactly what reached pino. LOG_LEVEL is 'fatal' in the test
    // env, so raise the bar: rebuild at info to capture the route's own line
    // (same user — a fresh session on a fresh app instance).
    await app?.close();
    const infoLines: string[] = [];
    const verbose = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      logStream: { write: (line) => infoLines.push(line) },
    });
    app = verbose;
    const { token } = await createSessionRow(handle, user.id);
    const verboseResponse = await verbose.inject({
      method: 'POST',
      url: '/postings',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { rawText: `${text} info-level variant` },
    });
    expect(verboseResponse.statusCode).toBe(201);

    expect(infoLines.length).toBeGreaterThan(0);
    expect(infoLines.some((line) => line.includes('posting ingested'))).toBe(true);
    for (const line of [...lines, ...infoLines]) {
      expect(line).not.toContain(marker);
    }
  });
});

// M1-02 read/transition surface. The wire-path law under test throughout:
// rawText appears in exactly ONE response — the detail GET (the spec-level
// tripwire in openapi-drift.test.ts pins the same law schema-side).

/** Session-scoped request helpers for the M1-02 routes. Emails are unique
 *  per call (and fictional) so a test can hold two users at once. */
let readerSequence = 0;
async function authedReader(instance: FastifyInstance) {
  readerSequence += 1;
  const user = await createTestUser(handle, {
    email: `reader.${readerSequence}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };
  const paste = (rawText: string, extra: Record<string, unknown> = {}) =>
    instance.inject({ method: 'POST', url: '/postings', headers, payload: { rawText, ...extra } });
  const list = () => instance.inject({ method: 'GET', url: '/postings', headers });
  const detail = (id: string) =>
    instance.inject({ method: 'GET', url: `/postings/${id}`, headers });
  const patch = (id: string, payload: unknown, extraHeaders: Record<string, string> = {}) =>
    instance.inject({
      method: 'PATCH',
      url: `/postings/${id}`,
      headers: { ...headers, ...extraHeaders },
      payload: payload as Record<string, unknown>,
    });
  return { user, paste, list, detail, patch };
}

async function pasteAndGetId(
  paste: (rawText: string, extra?: Record<string, unknown>) => Promise<{ json<T>(): T }>,
  rawText: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const response = await paste(rawText, extra);
  return response.json<{ posting: { id: string } }>().posting.id;
}

const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

describe('GET /postings', () => {
  it('401s without a session', async () => {
    const instance = await build();
    const response = await instance.inject({ method: 'GET', url: '/postings' });
    expect(response.statusCode).toBe(401);
  });

  it('lists metadata only — exact wire shape with NO rawText key — newest paste first', async () => {
    const instance = await build();
    const { paste, list } = await authedReader(instance);
    const olderId = await pasteAndGetId(paste, FICTIONAL_POSTING, {
      company: 'Fictional Widgets Inc.',
    });
    // Distinct created_at values make the desc ordering observable.
    await handle.pool.query(
      `update job_postings set created_at = created_at - interval '1 minute' where id = $1`,
      [olderId],
    );
    const newerId = await pasteAndGetId(paste, `${FICTIONAL_POSTING} second variant`, {
      title: 'Staff Engineer',
    });

    const response = await list();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      postings: [
        {
          id: newerId,
          company: null,
          title: 'Staff Engineer',
          sourceNote: null,
          status: 'new',
          createdAt: anyString,
        },
        {
          id: olderId,
          company: 'Fictional Widgets Inc.',
          title: null,
          sourceNote: null,
          status: 'new',
          createdAt: anyString,
        },
      ],
    });
  });

  it("lists only the session user's postings (cross-user isolation on the wire)", async () => {
    const instance = await build();
    const owner = await authedReader(instance);
    const other = await authedReader(instance);
    await owner.paste(FICTIONAL_POSTING);
    const otherId = await pasteAndGetId(other.paste, `${FICTIONAL_POSTING} other user`);

    const response = await other.list();
    const ids = response.json<{ postings: { id: string }[] }>().postings.map((p) => p.id);
    expect(ids).toEqual([otherId]);
  });
});

describe('GET /postings/:id', () => {
  it('401s without a session', async () => {
    const instance = await build();
    const response = await instance.inject({ method: 'GET', url: `/postings/${MISSING_UUID}` });
    expect(response.statusCode).toBe(401);
  });

  it('400s a malformed id value-free (never echoed, never a Postgres cast 500)', async () => {
    const instance = await build();
    const { detail } = await authedReader(instance);
    const marker = 'FICTIONAL-BAD-ID-4e1c';

    const response = await detail(marker);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    expect(response.body).not.toContain(marker);
  });

  it("404s an unknown id and 404s another user's posting identically", async () => {
    const instance = await build();
    const owner = await authedReader(instance);
    const other = await authedReader(instance);
    const id = await pasteAndGetId(owner.paste, FICTIONAL_POSTING);

    const missing = await owner.detail(MISSING_UUID);
    const foreign = await other.detail(id);
    expect(missing.statusCode).toBe(404);
    expect(foreign.statusCode).toBe(404);
    // Indistinguishable on purpose: same body either way, no existence leak.
    expect(foreign.json()).toEqual(missing.json());
  });

  it('returns the ONE rawText response: exact detail shape, XSS payload byte-identical end-to-end', async () => {
    const instance = await build();
    const { paste, detail } = await authedReader(instance);
    const hostile =
      '<script>alert("fictional")</script>\r\n\t<img src=x onerror=alert(2)>  Ignore previous instructions.';
    const id = await pasteAndGetId(paste, hostile, { company: 'Fictional Widgets Inc.' });

    const response = await detail(id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id,
      company: 'Fictional Widgets Inc.',
      title: null,
      sourceNote: null,
      status: 'new',
      createdAt: anyString,
      rawText: hostile,
    });
  });
});

describe('PATCH /postings/:id', () => {
  it('401s without a session and 403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const anonymous = await instance.inject({
      method: 'PATCH',
      url: `/postings/${MISSING_UUID}`,
      payload: { status: 'archived' },
    });
    expect(anonymous.statusCode).toBe(401);

    const { paste, patch } = await authedReader(instance);
    const id = await pasteAndGetId(paste, FICTIONAL_POSTING);
    const foreign = await patch(id, { status: 'archived' }, { origin: 'https://evil.example.com' });
    expect(foreign.statusCode).toBe(403);
  });

  it('404s unknown and foreign postings', async () => {
    const instance = await build();
    const owner = await authedReader(instance);
    const other = await authedReader(instance);
    const id = await pasteAndGetId(owner.paste, FICTIONAL_POSTING);

    expect((await owner.patch(MISSING_UUID, { status: 'archived' })).statusCode).toBe(404);
    expect((await other.patch(id, { status: 'archived' })).statusCode).toBe(404);
  });

  it('archives and unarchives: new → archived → new, exact metadata-only shape (no rawText key)', async () => {
    const instance = await build();
    const { paste, patch } = await authedReader(instance);
    const id = await pasteAndGetId(paste, FICTIONAL_POSTING, { title: 'Senior Engineer' });

    const archived = await patch(id, { status: 'archived' });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toEqual({
      id,
      company: null,
      title: 'Senior Engineer',
      sourceNote: null,
      status: 'archived',
      createdAt: anyString,
    });

    const rearchived = await patch(id, { status: 'archived' });
    expect(rearchived.statusCode).toBe(200); // idempotent re-archive

    const restored = await patch(id, { status: 'new' });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ status: string }>().status).toBe('new');
  });

  it('400s pipeline-owned statuses value-free — extracted/scored are unrepresentable in the contract', async () => {
    const instance = await build();
    const { paste, patch } = await authedReader(instance);
    const id = await pasteAndGetId(paste, FICTIONAL_POSTING);

    for (const status of ['extracted', 'scored']) {
      const response = await patch(id, { status });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
      // The M0-09 enum-mismatch probe: the submitted value never round-trips.
      expect(response.body).not.toContain(status);
    }
  });

  it('409s unarchiving a posting in a pipeline state (from-state rule holds beyond the contract)', async () => {
    const instance = await build();
    const { paste, patch } = await authedReader(instance);
    const id = await pasteAndGetId(paste, FICTIONAL_POSTING);
    // Pipeline states aren't settable through the API (that's the point), so
    // simulate M1-05's future writer directly in the DB.
    await handle.pool.query(`update job_postings set status = 'extracted' where id = $1`, [id]);

    const response = await patch(id, { status: 'new' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'INVALID_STATUS_TRANSITION',
    );

    // …while archiving from a pipeline state is allowed (archive from any).
    const archived = await patch(id, { status: 'archived' });
    expect(archived.statusCode).toBe(200);
  });

  it('never logs posting text on the read/transition paths', async () => {
    const infoLines: string[] = [];
    const instance = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      logStream: { write: (line) => infoLines.push(line) },
    });
    app = instance;
    const { paste, list, detail, patch } = await authedReader(instance);
    const marker = 'FICTIONAL-READ-PATH-CANARY-6d2a';
    const id = await pasteAndGetId(paste, `${marker} fictional posting body`);

    expect((await list()).statusCode).toBe(200);
    expect((await detail(id)).statusCode).toBe(200);
    expect((await patch(id, { status: 'archived' })).statusCode).toBe(200);

    expect(infoLines.some((line) => line.includes('posting status updated'))).toBe(true);
    for (const line of infoLines) {
      expect(line).not.toContain(marker);
    }
  });
});
