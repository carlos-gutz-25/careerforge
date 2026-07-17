import {
  createExtractionsRepository,
  createPostingsRepository,
  createUsersRepository,
  type ExtractionRunInsert,
  type RequirementInsert,
} from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runQuoteBackfill } from './quote-backfill.ts';

// Fictional fixture data only (RISKS P-01).
const POSTING_TEXT = [
  'Fictional Gizmo Works is hiring.',
  'Requirements: 3+ years of Go. Kubernetes a plus.',
].join('\n');

const handle = createTestDb();
const extractions = createExtractionsRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const users = createUsersRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

function runInsert(): ExtractionRunInsert {
  return {
    promptId: 'extract-requirements@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    rawResponse: { mock: true },
    inputTokens: 10,
    outputTokens: 5,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 5,
    attempt: 1,
    status: 'ok',
    createdAt: new Date('2026-07-17T09:00:00.000Z'),
  };
}

function requirement(sourceQuote: string): RequirementInsert {
  return {
    kind: 'must_have',
    category: 'language',
    text: 'fictional requirement text',
    sourceQuote,
    confidence: 0.9,
    quoteVerified: true, // reset to NULL below — the pre-M1-06 shape
  };
}

async function seedLegacyRun(quotes: string[]) {
  const user = await users.create({
    email: `backfill.fictional.${String(Math.random()).slice(2)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  const { posting } = await postings.ingest(user.id, {
    rawText: POSTING_TEXT,
    contentHash: `${String(Math.random()).slice(2)}`.padEnd(64, 'c').slice(0, 64),
    company: 'Fictional Gizmo Works',
    title: 'Backend Engineer',
    sourceNote: null,
  });
  const outcome = await extractions.persistExtraction(
    user.id,
    posting.id,
    [runInsert()],
    quotes.map(requirement),
  );
  // Reset verdicts AND the run status to the pre-M1-06 shape (verdicts NULL,
  // status as the runner left it) — persistExtraction now always sets both.
  await handle.db.execute(`update requirements set quote_verified = null`);
  await handle.db.execute(`update extraction_runs set status = 'ok'`);
  const runId = outcome.runs[0]?.id ?? '';
  return { user, posting, runId };
}

describe('runQuoteBackfill', () => {
  it('verifies NULL rows, flags runs holding fabricated quotes, and prints ids/counts only', async () => {
    const clean = await seedLegacyRun(['3+ years of Go', 'Kubernetes a plus']);
    const dirty = await seedLegacyRun(['3+ years of Go', 'fabricated quote never in the posting']);

    const lines: string[] = [];
    const totals = await runQuoteBackfill(extractions, (line) => lines.push(line));

    expect(totals).toEqual({
      runsProcessed: 2,
      requirementsVerified: 4,
      unverifiedRequirements: 1,
      runsFlagged: 1,
    });

    const cleanLine = lines.find((line) => line.includes(clean.runId));
    expect(cleanLine).toContain('checked 2, verified 2, unverified 0, status ok -> ok');
    const dirtyLine = lines.find((line) => line.includes(dirty.runId));
    expect(dirtyLine).toContain('checked 2, verified 1, unverified 1, status ok -> flagged');
    // Row ids only for false verdicts — never quote text on any output line.
    expect(lines.some((line) => line.trim().startsWith('unverified requirement '))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain('fabricated quote never in the posting');
      expect(line).not.toContain('Gizmo');
    }
  });

  it('is idempotent: a second pass finds nothing to do', async () => {
    await seedLegacyRun(['3+ years of Go']);
    await runQuoteBackfill(extractions, () => undefined);

    const lines: string[] = [];
    const totals = await runQuoteBackfill(extractions, (line) => lines.push(line));
    expect(totals).toEqual({
      runsProcessed: 0,
      requirementsVerified: 0,
      unverifiedRequirements: 0,
      runsFlagged: 0,
    });
    expect(lines).toEqual([]);
  });

  it('whitespace-variant quotes verify during backfill (same matcher as inline)', async () => {
    const { runId } = await seedLegacyRun(['3+  years\r\nof Go']);
    const lines: string[] = [];
    const totals = await runQuoteBackfill(extractions, (line) => lines.push(line));
    expect(totals.unverifiedRequirements).toBe(0);
    expect(lines.find((line) => line.includes(runId))).toContain('status ok -> ok');
  });
});
