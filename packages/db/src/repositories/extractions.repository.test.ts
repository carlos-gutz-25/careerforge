import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { extractionRuns, requirements } from '../schema/extractions.ts';
import { jobPostings } from '../schema/jobs.ts';
import {
  createExtractionsRepository,
  type ExtractionRunInsert,
  type RequirementInsert,
} from './extractions.repository.ts';
import { createPostingsRepository } from './postings.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Fictional fixture data only (RISKS P-01).
const EXTRACTOR = {
  email: 'extraction.tester.fictional@example.com',
  passwordHash: 'fake-hash-not-a-real-credential',
};

const PROMPT_ID = 'extract-requirements@v1';

function runInsert(overrides: Partial<ExtractionRunInsert> = {}): ExtractionRunInsert {
  return {
    promptId: PROMPT_ID,
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
    createdAt: new Date('2026-07-16T12:00:00.000Z'),
    ...overrides,
  };
}

function requirementInsert(overrides: Partial<RequirementInsert> = {}): RequirementInsert {
  return {
    kind: 'must_have',
    category: 'language',
    text: 'Fictional TypeScript requirement',
    sourceQuote: 'fictional verbatim quote',
    confidence: 0.9,
    quoteVerified: true,
    ...overrides,
  };
}

const handle = createTestDb();
const extractions = createExtractionsRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const users = createUsersRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

async function seedPosting(status: 'new' | 'extracted' | 'archived' = 'new') {
  const user = await users.create(EXTRACTOR);
  const { posting } = await postings.ingest(user.id, {
    rawText: 'Fictional posting body for extraction.',
    contentHash: 'b'.repeat(64),
    company: 'Fictional Widgets Inc.',
    title: 'Senior Software Engineer',
    sourceNote: null,
  });
  if (status !== 'new') {
    await handle.db.update(jobPostings).set({ status }).where(eq(jobPostings.id, posting.id));
  }
  return { user, posting };
}

describe('ExtractionsRepository.persistExtraction', () => {
  it('persists an ok run + requirements + posting flip in one shot, with createdAt from the supplied timestamp', async () => {
    const { user, posting } = await seedPosting();

    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [requirementInsert(), requirementInsert({ kind: 'nice_to_have', category: 'framework' })],
    );

    expect(outcome.runs).toHaveLength(1);
    expect(outcome.runs[0]).toMatchObject({
      userId: user.id,
      postingId: posting.id,
      promptId: PROMPT_ID,
      status: 'ok',
    });
    expect(outcome.runs[0]?.createdAt).toEqual(new Date('2026-07-16T12:00:00.000Z'));
    expect(outcome.requirements.map((r) => [r.position, r.kind])).toEqual([
      [0, 'must_have'],
      [1, 'nice_to_have'],
    ]);
    expect(outcome.postingFlipped).toBe(true);

    const [postingRow] = await handle.db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, posting.id));
    expect(postingRow?.status).toBe('extracted');
  });

  it('a retried extraction persists BOTH records; requirements FK the final ok row', async () => {
    const { user, posting } = await seedPosting();

    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ status: 'schema_failed', attempt: 1 }), runInsert({ attempt: 2 })],
      [requirementInsert()],
    );

    expect(outcome.runs.map((r) => [r.attempt, r.status])).toEqual([
      [1, 'schema_failed'],
      [2, 'ok'],
    ]);
    expect(outcome.requirements[0]?.extractionRunId).toBe(outcome.runs[1]?.id);
  });

  it('non-ok final runs persist without requirements and without a posting flip', async () => {
    const { user, posting } = await seedPosting();

    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [
        runInsert({ status: 'schema_failed', attempt: 1 }),
        runInsert({ status: 'schema_failed', attempt: 2 }),
      ],
      undefined,
    );

    expect(outcome.runs).toHaveLength(2);
    expect(outcome.requirements).toEqual([]);
    expect(outcome.postingFlipped).toBe(false);

    const [postingRow] = await handle.db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, posting.id));
    expect(postingRow?.status).toBe('new');
  });

  it('the flip is conditional: an already-extracted posting is untouched (no downgrade, re-extract keeps status)', async () => {
    const { user, posting } = await seedPosting('extracted');

    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [requirementInsert()],
    );

    expect(outcome.postingFlipped).toBe(false);
    const [postingRow] = await handle.db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, posting.id));
    expect(postingRow?.status).toBe('extracted');
  });

  it('a concurrently-archived posting keeps its audit rows while the flip no-ops', async () => {
    const { user, posting } = await seedPosting('archived');

    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [requirementInsert()],
    );

    expect(outcome.postingFlipped).toBe(false);
    expect(outcome.runs).toHaveLength(1);
    const [postingRow] = await handle.db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, posting.id));
    expect(postingRow?.status).toBe('archived');
  });

  it('ATOMICITY: a CHECK-violating requirement rolls back the run rows AND the flip (planted failure)', async () => {
    const { user, posting } = await seedPosting();

    const error = await extractions
      .persistExtraction(
        user.id,
        posting.id,
        [runInsert()],
        [requirementInsert({ category: 'not-a-category' as RequirementInsert['category'] })],
      )
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeDefined();
    expect(pgErrorCode(error)).toBe('23514');
    expect(await handle.db.select().from(extractionRuns)).toHaveLength(0);
    expect(await handle.db.select().from(requirements)).toHaveLength(0);
    const [postingRow] = await handle.db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, posting.id));
    expect(postingRow?.status).toBe('new');
  });

  it('CHECK constraints reject out-of-set status and kind at the DB layer', async () => {
    const { user, posting } = await seedPosting();

    const badStatus = await extractions
      .persistExtraction(
        user.id,
        posting.id,
        [runInsert({ status: 'pending' as ExtractionRunInsert['status'] })],
        undefined,
      )
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(pgErrorCode(badStatus)).toBe('23514');

    const badKind = await extractions
      .persistExtraction(
        user.id,
        posting.id,
        [runInsert()],
        [requirementInsert({ kind: 'required' as RequirementInsert['kind'] })],
      )
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(pgErrorCode(badKind)).toBe('23514');
  });

  it('rejects an empty runs array loudly', async () => {
    const { user, posting } = await seedPosting();
    await expect(extractions.persistExtraction(user.id, posting.id, [], undefined)).rejects.toThrow(
      /at least one run/,
    );
  });
});

describe('persistExtraction — M1-06 status derivation at insert time', () => {
  it('any failed verdict flags the final run; requirements commit; the posting still flips (widened gate)', async () => {
    const { user, posting } = await seedPosting();

    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [
        requirementInsert({ text: 'verified one' }),
        requirementInsert({ text: 'fabricated one', quoteVerified: false }),
      ],
    );

    expect(outcome.runs[0]?.status).toBe('flagged');
    expect(outcome.requirements.map((r) => r.quoteVerified)).toEqual([true, false]);
    expect(outcome.postingFlipped).toBe(true);
    const [postingRow] = await handle.db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, posting.id));
    expect(postingRow?.status).toBe('extracted');
  });

  it('all-true verdicts stay ok; retry records keep their runner statuses', async () => {
    const { user, posting } = await seedPosting();

    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ status: 'schema_failed', attempt: 1 }), runInsert({ attempt: 2 })],
      [requirementInsert()],
    );

    expect(outcome.runs.map((r) => r.status)).toEqual(['schema_failed', 'ok']);
  });

  it('runner failure statuses are never derivation candidates', async () => {
    const { user, posting } = await seedPosting();
    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ status: 'refusal' })],
      undefined,
    );
    expect(outcome.runs[0]?.status).toBe('refusal');
    expect(outcome.postingFlipped).toBe(false);
  });
});

describe('ExtractionsRepository.findRunsWithUnverifiedQuotes / applyQuoteVerification', () => {
  it('returns only runs holding NULL verdicts, with posting rawText and the FULL requirement set', async () => {
    const { user, posting } = await seedPosting();
    // A pre-M1-06 shaped run: verdicts NULL (inserted directly — the insert
    // path now always sets them, so the fixture bypasses the repository).
    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [requirementInsert({ text: 'legacy A' }), requirementInsert({ text: 'legacy B' })],
    );
    const runId = outcome.runs[0]?.id ?? '';
    await handle.db.update(requirements).set({ quoteVerified: null });

    const batches = await extractions.findRunsWithUnverifiedQuotes();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      runId,
      userId: user.id,
      postingId: posting.id,
      postingRawText: 'Fictional posting body for extraction.',
    });
    expect(batches[0]?.requirements.map((r) => r.quoteVerified)).toEqual([null, null]);
  });

  it('is empty when every verdict is set (idempotence of the backfill read)', async () => {
    const { user, posting } = await seedPosting();
    await extractions.persistExtraction(user.id, posting.id, [runInsert()], [requirementInsert()]);
    expect(await extractions.findRunsWithUnverifiedQuotes()).toEqual([]);
  });

  it('applyQuoteVerification sets verdicts, recomputes status via the shared policy, and is idempotent', async () => {
    const { user, posting } = await seedPosting();
    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [requirementInsert({ text: 'good' }), requirementInsert({ text: 'bad' })],
    );
    const runId = outcome.runs[0]?.id ?? '';
    const [goodRow, badRow] = outcome.requirements;
    await handle.db.update(requirements).set({ quoteVerified: null });

    const result = await extractions.applyQuoteVerification(user.id, runId, [
      { requirementId: goodRow?.id ?? '', quoteVerified: true },
      { requirementId: badRow?.id ?? '', quoteVerified: false },
    ]);
    expect(result).toEqual({ requirementsUpdated: 2, runStatus: 'flagged' });

    // Idempotent re-run: same verdicts, same outcome.
    const rerun = await extractions.applyQuoteVerification(user.id, runId, [
      { requirementId: goodRow?.id ?? '', quoteVerified: true },
      { requirementId: badRow?.id ?? '', quoteVerified: false },
    ]);
    expect(rerun).toEqual({ requirementsUpdated: 2, runStatus: 'flagged' });

    const rows = await handle.db.select().from(requirements).orderBy(requirements.position);
    expect(rows.map((r) => r.quoteVerified)).toEqual([true, false]);
  });

  it('all-true verdicts recompute the run back to ok (deterministic recompute, self-healing)', async () => {
    const { user, posting } = await seedPosting();
    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [requirementInsert({ quoteVerified: false })],
    );
    const runId = outcome.runs[0]?.id ?? '';
    expect(outcome.runs[0]?.status).toBe('flagged');

    const result = await extractions.applyQuoteVerification(user.id, runId, [
      { requirementId: outcome.requirements[0]?.id ?? '', quoteVerified: true },
    ]);
    expect(result).toEqual({ requirementsUpdated: 1, runStatus: 'ok' });
  });

  it('is user-scoped on writes: a foreign user updates nothing and throws', async () => {
    const { user, posting } = await seedPosting();
    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [requirementInsert()],
    );
    const stranger = await users.create({ ...EXTRACTOR, email: 'stranger2.fictional@example.com' });

    await expect(
      extractions.applyQuoteVerification(stranger.id, outcome.runs[0]?.id ?? '', [
        { requirementId: outcome.requirements[0]?.id ?? '', quoteVerified: false },
      ]),
    ).rejects.toThrow(/not found, foreign, or not requirement-bearing/);

    const rows = await handle.db.select().from(requirements);
    expect(rows[0]?.quoteVerified).toBe(true);
  });

  it('never recomputes a non-requirement-bearing run', async () => {
    const { user, posting } = await seedPosting();
    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ status: 'schema_failed' })],
      undefined,
    );
    await expect(
      extractions.applyQuoteVerification(user.id, outcome.runs[0]?.id ?? '', []),
    ).rejects.toThrow(/not found, foreign, or not requirement-bearing/);
  });
});

describe('ExtractionsRepository.findLatestRequirementBearingRun', () => {
  it('returns the newest ok run for the prompt with requirements in position order', async () => {
    const { user, posting } = await seedPosting();

    await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ createdAt: new Date('2026-07-16T10:00:00.000Z') })],
      [requirementInsert({ text: 'older run requirement' })],
    );
    await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ createdAt: new Date('2026-07-16T11:00:00.000Z') })],
      [
        requirementInsert({ text: 'newer A' }),
        requirementInsert({ text: 'newer B', kind: 'nice_to_have' }),
      ],
    );

    const hit = await extractions.findLatestRequirementBearingRun(user.id, posting.id, PROMPT_ID);
    expect(hit).toBeDefined();
    expect(hit?.run.createdAt).toEqual(new Date('2026-07-16T11:00:00.000Z'));
    expect(hit?.requirements.map((r) => r.text)).toEqual(['newer A', 'newer B']);
  });

  it('scopes by prompt id when given, and ignores non-ok runs', async () => {
    const { user, posting } = await seedPosting();
    await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ status: 'schema_failed' })],
      undefined,
    );

    expect(
      await extractions.findLatestRequirementBearingRun(user.id, posting.id, PROMPT_ID),
    ).toBeUndefined();

    await extractions.persistExtraction(user.id, posting.id, [runInsert()], [requirementInsert()]);
    expect(
      await extractions.findLatestRequirementBearingRun(user.id, posting.id, 'other-prompt@v9'),
    ).toBeUndefined();
    expect(await extractions.findLatestRequirementBearingRun(user.id, posting.id)).toBeDefined();
  });

  it('is user-scoped: a foreign user sees undefined', async () => {
    const { user, posting } = await seedPosting();
    await extractions.persistExtraction(user.id, posting.id, [runInsert()], [requirementInsert()]);

    const stranger = await users.create({ ...EXTRACTOR, email: 'stranger.fictional@example.com' });
    expect(
      await extractions.findLatestRequirementBearingRun(stranger.id, posting.id, PROMPT_ID),
    ).toBeUndefined();
    expect(await extractions.hasRequirementBearingRun(stranger.id, posting.id)).toBe(false);
  });
});

describe('ExtractionsRepository.hasRequirementBearingRun', () => {
  it('reflects whether any ok run exists (the unarchive restore law)', async () => {
    const { user, posting } = await seedPosting();
    expect(await extractions.hasRequirementBearingRun(user.id, posting.id)).toBe(false);

    await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ status: 'refusal' })],
      undefined,
    );
    expect(await extractions.hasRequirementBearingRun(user.id, posting.id)).toBe(false);

    await extractions.persistExtraction(user.id, posting.id, [runInsert()], [requirementInsert()]);
    expect(await extractions.hasRequirementBearingRun(user.id, posting.id)).toBe(true);
  });
});

describe('requirement-bearing widening (M1-06): flagged runs stay served', () => {
  it('serves a FLAGGED run with and without promptId — flipping must never vanish a run', async () => {
    const { user, posting } = await seedPosting();
    await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert()],
      [requirementInsert({ quoteVerified: false })],
    );

    const withPrompt = await extractions.findLatestRequirementBearingRun(
      user.id,
      posting.id,
      PROMPT_ID,
    );
    expect(withPrompt?.run.status).toBe('flagged');
    expect(withPrompt?.requirements.map((r) => r.quoteVerified)).toEqual([false]);
    const withoutPrompt = await extractions.findLatestRequirementBearingRun(user.id, posting.id);
    expect(withoutPrompt?.run.id).toBe(withPrompt?.run.id);
    expect(await extractions.hasRequirementBearingRun(user.id, posting.id)).toBe(true);
  });

  it('orders across ok and flagged runs by recency', async () => {
    const { user, posting } = await seedPosting();
    await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ createdAt: new Date('2026-07-16T10:00:00.000Z') })],
      [requirementInsert()],
    );
    await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ createdAt: new Date('2026-07-16T11:00:00.000Z') })],
      [requirementInsert({ quoteVerified: false })],
    );

    const latest = await extractions.findLatestRequirementBearingRun(user.id, posting.id);
    expect(latest?.run.status).toBe('flagged');
    expect(latest?.run.createdAt).toEqual(new Date('2026-07-16T11:00:00.000Z'));
  });
});

describe('findRequirementsForRun (M1-10 read for the GET fit path)', () => {
  it("returns ONE run's rows in position order, user-scoped, even when a later run exists", async () => {
    const { user, posting } = await seedPosting();
    const first = await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ createdAt: new Date('2026-07-16T10:00:00.000Z') })],
      [
        requirementInsert({ text: 'Fictional requirement A', sourceQuote: 'fictional quote A' }),
        requirementInsert({ text: 'Fictional requirement B', sourceQuote: 'fictional quote B' }),
      ],
    );
    // A later re-extraction: the first run is no longer the latest.
    await extractions.persistExtraction(
      user.id,
      posting.id,
      [runInsert({ createdAt: new Date('2026-07-16T11:00:00.000Z') })],
      [requirementInsert({ text: 'Fictional requirement C', sourceQuote: 'fictional quote C' })],
    );

    const firstRunId = first.runs[0]!.id;
    const rows = await extractions.findRequirementsForRun(user.id, firstRunId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.position)).toEqual([0, 1]);
    expect(rows.map((row) => row.text)).toEqual([
      'Fictional requirement A',
      'Fictional requirement B',
    ]);
    expect(rows.every((row) => row.extractionRunId === firstRunId)).toBe(true);

    // Foreign user sees nothing; an unknown run id is an empty set.
    const stranger = await users.create({
      email: 'stranger.fictional@example.com',
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    expect(await extractions.findRequirementsForRun(stranger.id, firstRunId)).toEqual([]);
    expect(
      await extractions.findRequirementsForRun(user.id, '99999999-9999-4999-8999-999999999999'),
    ).toEqual([]);
  });
});
