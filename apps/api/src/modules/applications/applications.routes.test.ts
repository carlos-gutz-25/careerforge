// /applications integration tests (M1-03). Every posting and note here is
// fictional. The laws under test: all stages user-driven but every transition
// leaves a system-written stage_change event (same transaction); stage_change
// is unrepresentable in the events POST contract; no application response
// carries posting rawText (exact toEqual below; the spec tripwire pins the
// same law schema-side); event detail never enters logs.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

const handle = createTestDb();
const env = buildTestEnv();

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

/** Session-scoped request helpers. Emails are unique per call (and
 *  fictional) so a test can hold two users at once (postings precedent). */
let trackerSequence = 0;
async function authedTracker(instance: FastifyInstance) {
  trackerSequence += 1;
  const user = await createTestUser(handle, {
    email: `tracker.${trackerSequence}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };
  const paste = async (rawText: string, extra: Record<string, unknown> = {}) => {
    const response = await instance.inject({
      method: 'POST',
      url: '/postings',
      headers,
      payload: { rawText, ...extra },
    });
    return response.json<{ posting: { id: string } }>().posting.id;
  };
  const create = (payload: unknown, extraHeaders: Record<string, string> = {}) =>
    instance.inject({
      method: 'POST',
      url: '/applications',
      headers: { ...headers, ...extraHeaders },
      payload: payload as Record<string, unknown>,
    });
  const list = (query = '') =>
    instance.inject({ method: 'GET', url: `/applications${query}`, headers });
  const detail = (id: string) =>
    instance.inject({ method: 'GET', url: `/applications/${id}`, headers });
  const patch = (id: string, payload: unknown, extraHeaders: Record<string, string> = {}) =>
    instance.inject({
      method: 'PATCH',
      url: `/applications/${id}`,
      headers: { ...headers, ...extraHeaders },
      payload: payload as Record<string, unknown>,
    });
  const addEvent = (id: string, payload: unknown) =>
    instance.inject({
      method: 'POST',
      url: `/applications/${id}/events`,
      headers,
      payload: payload as Record<string, unknown>,
    });
  return { user, paste, create, list, detail, patch, addEvent };
}

const MISSING_UUID = '00000000-0000-4000-8000-000000000000';
const FICTIONAL_POSTING =
  'Senior Software Engineer — Fictional Widgets Inc.\nBuild fictional APIs.';

// expect.any(String) is typed `any`; one cast keeps the asymmetric matcher
// usable inside typed expected objects (postings precedent).
const anyString = expect.any(String) as string;

describe('POST /applications', () => {
  it('401s without a session and 403s a foreign Origin (mutation → CSRF check)', async () => {
    const instance = await build();
    const anonymous = await instance.inject({
      method: 'POST',
      url: '/applications',
      payload: { postingId: MISSING_UUID },
    });
    expect(anonymous.statusCode).toBe(401);

    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const foreign = await tracker.create({ postingId }, { origin: 'https://evil.example.com' });
    expect(foreign.statusCode).toBe(403);
  });

  it('201-creates from a posting in exactly the wire shape: stage considering, appliedOn null', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);

    const response = await tracker.create({ postingId });
    expect(response.statusCode).toBe(201);
    // toEqual is exact: a stray userId/updatedAt/rawText on the wire fails.
    expect(response.json()).toEqual({
      application: {
        id: anyString,
        postingId,
        stage: 'considering',
        appliedOn: null,
        createdAt: anyString,
      },
      duplicate: false,
    });
  });

  it('re-tracking the same posting → 200, duplicate notice, the SAME stored record (M1-01 mirror)', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);

    const first = await tracker.create({ postingId });
    const firstApplication = first.json<{ application: { id: string } }>().application;

    const again = await tracker.create({ postingId });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ application: firstApplication, duplicate: true });
  });

  it("404s a missing posting and another user's posting identically (no existence leak)", async () => {
    const instance = await build();
    const owner = await authedTracker(instance);
    const other = await authedTracker(instance);
    const postingId = await owner.paste(FICTIONAL_POSTING);

    const missing = await owner.create({ postingId: MISSING_UUID });
    const foreign = await other.create({ postingId });
    expect(missing.statusCode).toBe(404);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json());
  });

  it('400s a malformed postingId value-free', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const marker = 'FICTIONAL-BAD-POSTING-ID-3a7e';

    const response = await tracker.create({ postingId: marker });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    expect(response.body).not.toContain(marker);
  });
});

describe('PATCH /applications/:id', () => {
  it('transitions the stage and the trail gains exactly one system stage_change event', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await tracker.patch(id, { stage: 'applied', occurredOn: '2026-07-10' });
    expect(response.statusCode).toBe(200);

    const detail = await tracker.detail(id);
    const { events } = detail.json<{ events: unknown[] }>();
    expect(events).toEqual([
      {
        id: anyString,
        kind: 'stage_change',
        detail: 'considering → applied',
        occurredOn: '2026-07-10',
        createdAt: anyString,
      },
    ]);
  });

  it('a BACKDATED transition into applied sets appliedOn to the transition date, never today (approval amendment)', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await tracker.patch(id, { stage: 'applied', occurredOn: '2026-07-03' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ appliedOn: string }>().appliedOn).toBe('2026-07-03');
  });

  it('omitted occurredOn defaults to today via the now seam (UTC date)', async () => {
    const fixedNow = new Date('2026-07-15T12:00:00.000Z');
    const instance = await build({ now: () => fixedNow });
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await tracker.patch(id, { stage: 'applied' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ appliedOn: string }>().appliedOn).toBe('2026-07-15');
  });

  it('appliedOn is first-entry-wins: re-entering applied later does NOT overwrite it', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    await tracker.patch(id, { stage: 'applied', occurredOn: '2026-07-03' });
    await tracker.patch(id, { stage: 'withdrawn', occurredOn: '2026-07-08' });
    const reapplied = await tracker.patch(id, { stage: 'applied', occurredOn: '2026-07-12' });

    expect(reapplied.statusCode).toBe(200);
    expect(reapplied.json<{ appliedOn: string }>().appliedOn).toBe('2026-07-03');
    // The trail still records all three transitions with their own dates.
    const detail = await tracker.detail(id);
    const events = detail.json<{ events: { detail: string; occurredOn: string }[] }>().events;
    expect(events.map((event) => [event.detail, event.occurredOn])).toEqual([
      ['considering → applied', '2026-07-03'],
      ['applied → withdrawn', '2026-07-08'],
      ['withdrawn → applied', '2026-07-12'],
    ]);
  });

  it('any distinct stage is reachable (lenient graph): rejected → considering', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    expect((await tracker.patch(id, { stage: 'rejected' })).statusCode).toBe(200);
    const back = await tracker.patch(id, { stage: 'considering' });
    expect(back.statusCode).toBe(200);
    expect(back.json<{ stage: string }>().stage).toBe('considering');
  });

  it('409s a same-stage PATCH (every successful PATCH emits exactly one event — no no-op trail garbage)', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await tracker.patch(id, { stage: 'considering' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'INVALID_STAGE_TRANSITION',
    );
    // No event recorded a transition that didn't happen.
    const detail = await tracker.detail(id);
    expect(detail.json<{ events: unknown[] }>().events).toEqual([]);
  });

  it('401s without a session, 403s a foreign Origin, 404s unknown and foreign applications', async () => {
    const instance = await build();
    const anonymous = await instance.inject({
      method: 'PATCH',
      url: `/applications/${MISSING_UUID}`,
      payload: { stage: 'applied' },
    });
    expect(anonymous.statusCode).toBe(401);

    const owner = await authedTracker(instance);
    const other = await authedTracker(instance);
    const postingId = await owner.paste(FICTIONAL_POSTING);
    const created = await owner.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const foreignOrigin = await owner.patch(
      id,
      { stage: 'applied' },
      { origin: 'https://evil.example.com' },
    );
    expect(foreignOrigin.statusCode).toBe(403);

    const missing = await owner.patch(MISSING_UUID, { stage: 'applied' });
    const foreign = await other.patch(id, { stage: 'applied' });
    expect(missing.statusCode).toBe(404);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json());
  });
});

describe('POST /applications/:id/events', () => {
  it('201-appends a note and echoes the stored event exactly', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await tracker.addEvent(id, {
      kind: 'note',
      detail: 'Fictional recruiter replied — screen scheduled.',
      occurredOn: '2026-07-14',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: anyString,
      kind: 'note',
      detail: 'Fictional recruiter replied — screen scheduled.',
      occurredOn: '2026-07-14',
      createdAt: anyString,
    });
  });

  it('omitted occurredOn defaults to today via the now seam', async () => {
    const fixedNow = new Date('2026-07-15T12:00:00.000Z');
    const instance = await build({ now: () => fixedNow });
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await tracker.addEvent(id, { kind: 'outcome', detail: 'Fictional offer.' });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ occurredOn: string }>().occurredOn).toBe('2026-07-15');
  });

  it('stage_change is unrepresentable: 400, value-free — the response never contains the kind', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await tracker.addEvent(id, {
      kind: 'stage_change',
      detail: 'hand-forged transition',
      occurredOn: '2026-07-14',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    // The M0-09 enum-mismatch probe: the submitted value never round-trips.
    expect(response.body).not.toContain('stage_change');
    // And nothing was written.
    const detail = await tracker.detail(id);
    expect(detail.json<{ events: unknown[] }>().events).toEqual([]);
  });

  it('400s missing and whitespace-only detail (a detail-free event is no event at all)', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    expect((await tracker.addEvent(id, { kind: 'note' })).statusCode).toBe(400);
    expect((await tracker.addEvent(id, { kind: 'note', detail: '  \t \r\n ' })).statusCode).toBe(
      400,
    );
  });

  it("404s another user's application (no cross-user event writes)", async () => {
    const instance = await build();
    const owner = await authedTracker(instance);
    const other = await authedTracker(instance);
    const postingId = await owner.paste(FICTIONAL_POSTING);
    const created = await owner.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await other.addEvent(id, { kind: 'note', detail: 'foreign write attempt' });
    expect(response.statusCode).toBe(404);
    const detail = await owner.detail(id);
    expect(detail.json<{ events: unknown[] }>().events).toEqual([]);
  });
});

describe('GET /applications', () => {
  it('401s without a session', async () => {
    const instance = await build();
    const response = await instance.inject({ method: 'GET', url: '/applications' });
    expect(response.statusCode).toBe(401);
  });

  it('lists with posting summaries in exactly the wire shape — no rawText key anywhere', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING, {
      company: 'Fictional Widgets Inc.',
      title: 'Senior Software Engineer',
    });
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const response = await tracker.list();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      applications: [
        {
          id,
          postingId,
          stage: 'considering',
          appliedOn: null,
          createdAt: anyString,
          posting: { company: 'Fictional Widgets Inc.', title: 'Senior Software Engineer' },
        },
      ],
    });
  });

  it('filters by stage and by postingId (the AC filter + the tracked-state probe)', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingA = await tracker.paste(FICTIONAL_POSTING);
    const postingB = await tracker.paste(`${FICTIONAL_POSTING} second variant`);
    const a = await tracker.create({ postingId: postingA });
    const b = await tracker.create({ postingId: postingB });
    const idA = a.json<{ application: { id: string } }>().application.id;
    const idB = b.json<{ application: { id: string } }>().application.id;
    await tracker.patch(idB, { stage: 'applied' });

    const applied = await tracker.list('?stage=applied');
    expect(
      applied.json<{ applications: { id: string }[] }>().applications.map((row) => row.id),
    ).toEqual([idB]);

    const byPosting = await tracker.list(`?postingId=${postingA}`);
    expect(
      byPosting.json<{ applications: { id: string }[] }>().applications.map((row) => row.id),
    ).toEqual([idA]);

    const empty = await tracker.list('?stage=offer');
    expect(empty.json<{ applications: unknown[] }>().applications).toEqual([]);
  });

  it('400s an invalid stage filter value-free', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const marker = 'FICTIONAL-BAD-STAGE-9c1f';

    const response = await tracker.list(`?stage=${marker}`);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    expect(response.body).not.toContain(marker);
  });

  it("lists only the session user's applications (cross-user isolation on the wire)", async () => {
    const instance = await build();
    const owner = await authedTracker(instance);
    const other = await authedTracker(instance);
    const ownerPosting = await owner.paste(FICTIONAL_POSTING);
    await owner.create({ postingId: ownerPosting });
    const otherPosting = await other.paste(FICTIONAL_POSTING);
    const created = await other.create({ postingId: otherPosting });
    const otherId = created.json<{ application: { id: string } }>().application.id;

    const response = await other.list();
    expect(
      response.json<{ applications: { id: string }[] }>().applications.map((row) => row.id),
    ).toEqual([otherId]);
  });
});

describe('GET /applications/:id', () => {
  it("404s an unknown id and another user's application identically", async () => {
    const instance = await build();
    const owner = await authedTracker(instance);
    const other = await authedTracker(instance);
    const postingId = await owner.paste(FICTIONAL_POSTING);
    const created = await owner.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    const missing = await owner.detail(MISSING_UUID);
    const foreign = await other.detail(id);
    expect(missing.statusCode).toBe(404);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json());
  });

  it('returns the application, posting summary, and chronological trail in exactly the wire shape', async () => {
    const instance = await build();
    const tracker = await authedTracker(instance);
    const postingId = await tracker.paste(FICTIONAL_POSTING, {
      company: 'Fictional Widgets Inc.',
    });
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;
    await tracker.patch(id, { stage: 'applied', occurredOn: '2026-07-10' });
    await tracker.addEvent(id, {
      kind: 'note',
      detail: 'Fictional note, earlier date.',
      occurredOn: '2026-07-05',
    });

    const response = await tracker.detail(id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id,
      postingId,
      stage: 'applied',
      appliedOn: '2026-07-10',
      createdAt: anyString,
      posting: { company: 'Fictional Widgets Inc.', title: null },
      events: [
        {
          id: anyString,
          kind: 'note',
          detail: 'Fictional note, earlier date.',
          occurredOn: '2026-07-05',
          createdAt: anyString,
        },
        {
          id: anyString,
          kind: 'stage_change',
          detail: 'considering → applied',
          occurredOn: '2026-07-10',
          createdAt: anyString,
        },
      ],
    });
  });
});

describe('application logging', () => {
  it('never logs event detail content — length only (the no-text-in-logs law, applied to details)', async () => {
    const infoLines: string[] = [];
    const instance = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      logStream: { write: (line) => infoLines.push(line) },
    });
    app = instance;
    const tracker = await authedTracker(instance);
    const marker = 'FICTIONAL-DETAIL-CANARY-5b8d';
    const postingId = await tracker.paste(FICTIONAL_POSTING);
    const created = await tracker.create({ postingId });
    const { id } = created.json<{ application: { id: string } }>().application;

    expect((await tracker.patch(id, { stage: 'applied' })).statusCode).toBe(200);
    expect(
      (await tracker.addEvent(id, { kind: 'note', detail: `${marker} fictional note body` }))
        .statusCode,
    ).toBe(201);

    expect(infoLines.some((line) => line.includes('application event added'))).toBe(true);
    expect(infoLines.some((line) => line.includes('application stage updated'))).toBe(true);
    for (const line of infoLines) {
      expect(line).not.toContain(marker);
    }
  });
});
