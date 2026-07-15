import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { jobPostings } from '../schema/jobs.ts';
import { createPostingsRepository, type PostingIngestData } from './postings.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Fictional fixture data only (RISKS P-01).
const PASTER = {
  email: 'posting.paster.fictional@example.com',
  passwordHash: 'fake-hash-not-a-real-credential',
};

function ingestData(overrides: Partial<PostingIngestData> = {}): PostingIngestData {
  return {
    rawText: 'Fictional posting body.\nBuild fictional systems.',
    contentHash: 'a'.repeat(64),
    company: 'Fictional Widgets Inc.',
    title: 'Senior Software Engineer',
    sourceNote: null,
    ...overrides,
  };
}

const handle = createTestDb();
const postings = createPostingsRepository(handle.db);
const users = createUsersRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

describe('PostingsRepository.ingest', () => {
  it('inserts a new posting with status new and returns created: true', async () => {
    const user = await users.create(PASTER);
    const { posting, created } = await postings.ingest(user.id, ingestData());

    expect(created).toBe(true);
    expect(posting).toMatchObject({
      userId: user.id,
      rawText: 'Fictional posting body.\nBuild fictional systems.',
      contentHash: 'a'.repeat(64),
      company: 'Fictional Widgets Inc.',
      status: 'new',
    });
  });

  it('returns the existing row untouched on a hash collision for the same user (first write wins)', async () => {
    const user = await users.create(PASTER);
    const first = await postings.ingest(user.id, ingestData());
    const second = await postings.ingest(
      user.id,
      ingestData({ company: 'A Different Fictional Name', sourceNote: 'late note' }),
    );

    expect(second.created).toBe(false);
    expect(second.posting).toEqual(first.posting);

    const rows = await handle.db.select().from(jobPostings);
    expect(rows).toHaveLength(1);
  });

  it('same hash under different users creates independent rows (dedupe is per-user)', async () => {
    const userA = await users.create(PASTER);
    const userB = await users.create({ ...PASTER, email: 'second.paster@example.com' });

    const a = await postings.ingest(userA.id, ingestData());
    const b = await postings.ingest(userB.id, ingestData());

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.posting.id).not.toBe(a.posting.id);
  });

  it('the unique constraint is the backstop: a raw duplicate insert bypassing ingest() is rejected 23505', async () => {
    const user = await users.create(PASTER);
    await postings.ingest(user.id, ingestData());

    await expect(
      handle.db.insert(jobPostings).values({ userId: user.id, ...ingestData() }),
    ).rejects.toSatisfy((error: unknown) => pgErrorCode(error) === '23505');
  });
});

describe('PostingsRepository.listForUser', () => {
  it('returns metadata rows WITHOUT rawText/contentHash keys, newest paste first', async () => {
    const user = await users.create(PASTER);
    const first = await postings.ingest(user.id, ingestData({ contentHash: 'a'.repeat(64) }));
    // Force distinct created_at values so the desc ordering is observable.
    await handle.db
      .update(jobPostings)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(jobPostings.id, first.posting.id));
    const second = await postings.ingest(
      user.id,
      ingestData({ contentHash: 'b'.repeat(64), title: 'Staff Engineer' }),
    );

    const rows = await postings.listForUser(user.id);

    expect(rows.map((row) => row.id)).toEqual([second.posting.id, first.posting.id]);
    for (const row of rows) {
      expect(row).not.toHaveProperty('rawText');
      expect(row).not.toHaveProperty('contentHash');
    }
  });

  it("returns only the requesting user's postings (cross-user isolation)", async () => {
    const userA = await users.create(PASTER);
    const userB = await users.create({ ...PASTER, email: 'second.paster@example.com' });
    await postings.ingest(userA.id, ingestData());
    const b = await postings.ingest(userB.id, ingestData({ contentHash: 'c'.repeat(64) }));

    const rows = await postings.listForUser(userB.id);

    expect(rows.map((row) => row.id)).toEqual([b.posting.id]);
  });
});

describe('PostingsRepository.findForUser', () => {
  it('returns the full row (rawText included) for the owner, undefined for another user', async () => {
    const owner = await users.create(PASTER);
    const other = await users.create({ ...PASTER, email: 'second.paster@example.com' });
    const { posting } = await postings.ingest(owner.id, ingestData());

    const found = await postings.findForUser(owner.id, posting.id);
    expect(found?.rawText).toBe('Fictional posting body.\nBuild fictional systems.');

    expect(await postings.findForUser(other.id, posting.id)).toBeUndefined();
  });
});

describe('PostingsRepository.updateStatus', () => {
  it('updates only when the current status matches, returning the new row', async () => {
    const user = await users.create(PASTER);
    const { posting } = await postings.ingest(user.id, ingestData());

    const archived = await postings.updateStatus(user.id, posting.id, 'new', 'archived');
    expect(archived?.status).toBe('archived');

    const restored = await postings.updateStatus(user.id, posting.id, 'archived', 'new');
    expect(restored?.status).toBe('new');
  });

  it('returns undefined on a stale expectedCurrent (the concurrent-change window), leaving the row untouched', async () => {
    const user = await users.create(PASTER);
    const { posting } = await postings.ingest(user.id, ingestData());

    const result = await postings.updateStatus(user.id, posting.id, 'archived', 'new');

    expect(result).toBeUndefined();
    const found = await postings.findForUser(user.id, posting.id);
    expect(found?.status).toBe('new');
  });

  it("returns undefined for another user's posting (user-scoped, no cross-user writes)", async () => {
    const owner = await users.create(PASTER);
    const other = await users.create({ ...PASTER, email: 'second.paster@example.com' });
    const { posting } = await postings.ingest(owner.id, ingestData());

    expect(await postings.updateStatus(other.id, posting.id, 'new', 'archived')).toBeUndefined();
    const found = await postings.findForUser(owner.id, posting.id);
    expect(found?.status).toBe('new');
  });
});
