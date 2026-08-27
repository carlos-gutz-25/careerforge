// Chicago-evening regression for the date-only mints (timezone sweep
// 2026-08-26). Lives apart from applications.routes.test.ts because TZ is
// process state: this file pins America/Chicago and must not leak that into
// the suite that documents UTC-runner behavior. CI runners default to UTC,
// where the old toISOString().slice(0, 10) mint and toLocalDateString agree
// on every instant - a green UTC run cannot tell the fix from the defect. So
// the zone is pinned AND the fixture is an EVENING instant: 01:30Z is 20:30
// on the PREVIOUS Chicago day. The suite's shared noon fixture is
// zone-insensitive (noon UTC is the same calendar day in both zones) and
// would pass identically on both sides of the fix.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

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

// 20:30 in Chicago on the 26th; already the 27th in UTC.
const CHICAGO_EVENING = new Date('2026-08-27T01:30:00.000Z');
const PREVIOUS_CHICAGO_DAY = '2026-08-26';

const initialTz = process.env.TZ;
beforeAll(() => {
  // Node re-reads TZ on assignment, so every date the service mints after
  // this line is Chicago-local regardless of the runner's zone.
  process.env.TZ = 'America/Chicago';
});
afterAll(async () => {
  if (initialTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = initialTz;
  }
  await handle.pool.end();
});

let app: FastifyInstance | undefined;
beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const FICTIONAL_POSTING =
  'Senior Software Engineer - Fictional Widgets Inc.\nBuild fictional APIs.';

/** One authed application whose app was built with the evening now seam. */
async function eveningApplication() {
  const deps: AppDeps = { now: () => CHICAGO_EVENING };
  app = await buildApp(env, { dbHandle: handle, ...deps });
  const user = await createTestUser(handle, {
    email: 'tz.evening.fictional@example.com',
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER };
  const pasted = await app.inject({
    method: 'POST',
    url: '/postings',
    headers,
    payload: { rawText: FICTIONAL_POSTING },
  });
  const postingId = pasted.json<{ posting: { id: string } }>().posting.id;
  const created = await app.inject({
    method: 'POST',
    url: '/applications',
    headers,
    payload: { postingId },
  });
  const { id } = created.json<{ application: { id: string } }>().application;
  return { instance: app, headers, id };
}

describe('date-only mints under America/Chicago at a UTC-evening instant', () => {
  it('omitted occurredOn on a stage transition defaults to the previous Chicago day', async () => {
    const { instance, headers, id } = await eveningApplication();

    const response = await instance.inject({
      method: 'PATCH',
      url: `/applications/${id}`,
      headers,
      payload: { stage: 'applied' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ appliedOn: string }>().appliedOn).toBe(PREVIOUS_CHICAGO_DAY);
  });

  it('omitted occurredOn on an event defaults to the previous Chicago day', async () => {
    const { instance, headers, id } = await eveningApplication();

    const response = await instance.inject({
      method: 'POST',
      url: `/applications/${id}/events`,
      headers,
      payload: { kind: 'outcome', detail: 'Fictional offer.' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ occurredOn: string }>().occurredOn).toBe(PREVIOUS_CHICAGO_DAY);
  });
});
