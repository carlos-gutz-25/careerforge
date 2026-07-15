import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { applicationEvents, applications } from '../schema/jobs.ts';
import { createApplicationsRepository } from './applications.repository.ts';
import { createPostingsRepository } from './postings.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Fictional fixture data only (RISKS P-01).
const TRACKER = {
  email: 'application.tracker.fictional@example.com',
  passwordHash: 'fake-hash-not-a-real-credential',
};

const handle = createTestDb();
const repo = createApplicationsRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const users = createUsersRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

async function trackedPosting(userId: string, contentHash = 'a'.repeat(64)) {
  const { posting } = await postings.ingest(userId, {
    rawText: `Fictional posting body ${contentHash.slice(0, 8)}.`,
    contentHash,
    company: 'Fictional Widgets Inc.',
    title: 'Senior Software Engineer',
    sourceNote: null,
  });
  return posting;
}

const noteEvent = (occurredOn = '2026-07-15') => ({
  kind: 'note' as const,
  detail: 'Fictional recruiter said hello.',
  occurredOn,
});

describe('ApplicationsRepository.create', () => {
  it('creates with stage considering and null appliedOn, returns created: true', async () => {
    const user = await users.create(TRACKER);
    const posting = await trackedPosting(user.id);

    const { application, created } = await repo.create(user.id, posting.id);

    expect(created).toBe(true);
    expect(application).toMatchObject({
      userId: user.id,
      postingId: posting.id,
      stage: 'considering',
      appliedOn: null,
    });
  });

  it('is race-safe: a second create for the same posting returns the stored row, created: false', async () => {
    const user = await users.create(TRACKER);
    const posting = await trackedPosting(user.id);

    const first = await repo.create(user.id, posting.id);
    const second = await repo.create(user.id, posting.id);

    expect(second.created).toBe(false);
    expect(second.application).toEqual(first.application);
  });
});

describe('ApplicationsRepository.transitionStage', () => {
  it('updates the stage and writes exactly one stage_change event in the same call', async () => {
    const user = await users.create(TRACKER);
    const posting = await trackedPosting(user.id);
    const { application } = await repo.create(user.id, posting.id);

    const updated = await repo.transitionStage(
      user.id,
      application.id,
      'considering',
      { stage: 'applied', appliedOn: '2026-07-10' },
      { kind: 'stage_change', detail: 'considering → applied', occurredOn: '2026-07-10' },
    );

    expect(updated).toMatchObject({ stage: 'applied', appliedOn: '2026-07-10' });
    const events = await repo.listEvents(user.id, application.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'stage_change',
      detail: 'considering → applied',
      occurredOn: '2026-07-10',
    });
  });

  it('stale expectedCurrent → undefined AND zero event rows (the transaction writes nothing)', async () => {
    const user = await users.create(TRACKER);
    const posting = await trackedPosting(user.id);
    const { application } = await repo.create(user.id, posting.id);

    const result = await repo.transitionStage(
      user.id,
      application.id,
      'applied', // actually 'considering' — a concurrently-staled view
      { stage: 'screen' },
      { kind: 'stage_change', detail: 'applied → screen', occurredOn: '2026-07-15' },
    );

    expect(result).toBeUndefined();
    const found = await repo.findForUser(user.id, application.id);
    expect(found?.stage).toBe('considering');
    expect(await repo.listEvents(user.id, application.id)).toEqual([]);
  });

  it("returns undefined for another user's application (user-scoped, no cross-user writes)", async () => {
    const owner = await users.create(TRACKER);
    const other = await users.create({ ...TRACKER, email: 'second.tracker@example.com' });
    const posting = await trackedPosting(owner.id);
    const { application } = await repo.create(owner.id, posting.id);

    const result = await repo.transitionStage(
      other.id,
      application.id,
      'considering',
      { stage: 'applied' },
      { kind: 'stage_change', detail: 'considering → applied', occurredOn: '2026-07-15' },
    );

    expect(result).toBeUndefined();
    expect(await repo.listEvents(owner.id, application.id)).toEqual([]);
  });
});

describe('ApplicationsRepository.listForUser', () => {
  it('joins company/title only, filters by stage and postingId in SQL, newest-tracked first', async () => {
    const user = await users.create(TRACKER);
    const postingA = await trackedPosting(user.id, 'a'.repeat(64));
    const postingB = await trackedPosting(user.id, 'b'.repeat(64));
    const a = await repo.create(user.id, postingA.id);
    // Force distinct created_at so the desc ordering is observable.
    await handle.db
      .update(applications)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(applications.id, a.application.id));
    const b = await repo.create(user.id, postingB.id);
    await repo.transitionStage(
      user.id,
      b.application.id,
      'considering',
      { stage: 'applied' },
      { kind: 'stage_change', detail: 'considering → applied', occurredOn: '2026-07-15' },
    );

    const all = await repo.listForUser(user.id, {});
    expect(all.map((row) => row.id)).toEqual([b.application.id, a.application.id]);
    expect(all[0]?.posting).toEqual({
      company: 'Fictional Widgets Inc.',
      title: 'Senior Software Engineer',
    });

    const applied = await repo.listForUser(user.id, { stage: 'applied' });
    expect(applied.map((row) => row.id)).toEqual([b.application.id]);

    const byPosting = await repo.listForUser(user.id, { postingId: postingA.id });
    expect(byPosting.map((row) => row.id)).toEqual([a.application.id]);
  });

  it("returns only the requesting user's applications (cross-user isolation)", async () => {
    const userA = await users.create(TRACKER);
    const userB = await users.create({ ...TRACKER, email: 'second.tracker@example.com' });
    const postingA = await trackedPosting(userA.id, 'a'.repeat(64));
    const postingB = await trackedPosting(userB.id, 'b'.repeat(64));
    await repo.create(userA.id, postingA.id);
    const b = await repo.create(userB.id, postingB.id);

    const rows = await repo.listForUser(userB.id, {});
    expect(rows.map((row) => row.id)).toEqual([b.application.id]);
  });
});

describe('ApplicationsRepository.findForUser', () => {
  it('returns the row with its posting summary for the owner, undefined for another user', async () => {
    const owner = await users.create(TRACKER);
    const other = await users.create({ ...TRACKER, email: 'second.tracker@example.com' });
    const posting = await trackedPosting(owner.id);
    const { application } = await repo.create(owner.id, posting.id);

    const found = await repo.findForUser(owner.id, application.id);
    expect(found?.posting).toEqual({
      company: 'Fictional Widgets Inc.',
      title: 'Senior Software Engineer',
    });
    expect(found).not.toHaveProperty('rawText');

    expect(await repo.findForUser(other.id, application.id)).toBeUndefined();
  });
});

describe('ApplicationsRepository.listEvents / addEvent', () => {
  it('orders the trail by occurredOn, then createdAt, then id (chronological, deterministic)', async () => {
    const user = await users.create(TRACKER);
    const posting = await trackedPosting(user.id);
    const { application } = await repo.create(user.id, posting.id);

    const later = await repo.addEvent(user.id, application.id, noteEvent('2026-07-14'));
    const earlier = await repo.addEvent(user.id, application.id, noteEvent('2026-07-01'));
    // Same occurredOn as `later`, older createdAt → createdAt breaks the tie.
    const sameDayOlderInsert = await repo.addEvent(user.id, application.id, noteEvent('2026-07-14'));
    await handle.db
      .update(applicationEvents)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(applicationEvents.id, sameDayOlderInsert.id));

    const events = await repo.listEvents(user.id, application.id);
    expect(events.map((event) => event.id)).toEqual([
      earlier.id,
      sameDayOlderInsert.id,
      later.id,
    ]);
  });

  it("does not return another user's events (user-scoped read)", async () => {
    const owner = await users.create(TRACKER);
    const other = await users.create({ ...TRACKER, email: 'second.tracker@example.com' });
    const posting = await trackedPosting(owner.id);
    const { application } = await repo.create(owner.id, posting.id);
    await repo.addEvent(owner.id, application.id, noteEvent());

    expect(await repo.listEvents(other.id, application.id)).toEqual([]);
  });
});
