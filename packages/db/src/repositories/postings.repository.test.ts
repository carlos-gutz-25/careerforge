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
