// Behavioral wrapper test for the verify-quotes CLI (O-4 pre-task, M1-07 park
// homed as M1-09 slice 1). The WRAPPER is the surface under test: real exit
// codes, stdout/stderr composition, and the failure path's migrate hint —
// observed by spawning the actual CLI as a subprocess. The inner backfill's
// verdict/flagging logic is quote-backfill.test.ts's business, and the
// empty-env guard (exit 1 naming DATABASE_URL) is cli-smoke.test.ts's; neither
// is re-pinned here. Output law, pinned end to end: counts/ids/statuses only —
// NEVER quote or posting text (this CLI runs against the real database in
// production use).
//
// Spawns run against the shared careerforge_test database; this project runs
// test files serially (fileParallelism: false), so the subprocess cannot race
// another file's TRUNCATE. All fixture data is fictional (RISKS P-01).
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createExtractionsRepository,
  createPostingsRepository,
  createUsersRepository,
  type ExtractionRunInsert,
  type RequirementInsert,
} from '@careerforge/db';
import {
  createTestDb,
  resolveTestDatabaseUrl,
  truncateAllTables,
} from '@careerforge/db/test-utils';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('./verify-quotes.ts', import.meta.url));
const SPAWN_TEST_TIMEOUT = 30_000;

const handle = createTestDb();
const extractions = createExtractionsRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const users = createUsersRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

const POSTING_TEXT = [
  'Fictional Gizmo Works is hiring.',
  'Requirements: 3+ years of Go. Kubernetes a plus.',
].join('\n');

/** The subprocess sees ONLY the database URL — mirrors cli-smoke's minimal-env
 *  posture, and proves the wrapper needs nothing else. */
async function runCli(databaseUrl: string) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH], {
      env: { DATABASE_URL: databaseUrl },
      timeout: SPAWN_TEST_TIMEOUT,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failed.code ?? -1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}

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
    createdAt: new Date('2026-07-18T09:00:00.000Z'),
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

let seedSequence = 0;
async function seedLegacyRun(quotes: string[]) {
  seedSequence += 1;
  const user = await users.create({
    email: `verify-cli.fictional.${String(seedSequence)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  const { posting } = await postings.ingest(user.id, {
    rawText: POSTING_TEXT,
    contentHash: String(seedSequence).padEnd(64, 'd').slice(0, 64),
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
  // Reset verdicts AND run status to the pre-M1-06 shape (verdicts NULL,
  // status as the runner left it) — persistExtraction now always sets both.
  await handle.db.execute(`update requirements set quote_verified = null`);
  await handle.db.execute(`update extraction_runs set status = 'ok'`);
  return { runId: outcome.runs[0]?.id ?? '' };
}

describe('verify-quotes CLI wrapper', () => {
  it(
    'exits 0 with the nothing-to-verify line on a database holding no NULL verdicts',
    async () => {
      const { exitCode, stdout, stderr } = await runCli(resolveTestDatabaseUrl());

      expect(exitCode).toBe(0);
      expect(stdout).toBe('nothing to verify — no requirement-bearing run holds NULL verdicts.\n');
      expect(stderr).toBe('');
    },
    SPAWN_TEST_TIMEOUT,
  );

  it(
    'verifies seeded legacy runs: exit 0, per-run + summary lines with ids/counts only; re-run finds nothing',
    async () => {
      const clean = await seedLegacyRun(['3+ years of Go', 'Kubernetes a plus']);
      const dirty = await seedLegacyRun([
        '3+ years of Go',
        'fabricated quote never in the posting',
      ]);

      const first = await runCli(resolveTestDatabaseUrl());
      expect(first.exitCode).toBe(0);
      expect(first.stderr).toBe('');
      expect(first.stdout).toContain(clean.runId);
      expect(first.stdout).toContain(dirty.runId);
      // Row ids only for false verdicts, then the totals line — the wrapper's
      // own composition, not the backfill's.
      expect(first.stdout).toContain('unverified requirement ');
      expect(first.stdout).toContain(
        'verified 4 requirement(s) across 2 run(s): 1 unverified, 1 run(s) flagged.\n',
      );
      // NEVER quote or posting text on either stream.
      for (const leaked of ['fabricated quote never in the posting', '3+ years of Go', 'Gizmo']) {
        expect(first.stdout).not.toContain(leaked);
        expect(first.stderr).not.toContain(leaked);
      }

      const second = await runCli(resolveTestDatabaseUrl());
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toBe(
        'nothing to verify — no requirement-bearing run holds NULL verdicts.\n',
      );
    },
    SPAWN_TEST_TIMEOUT,
  );

  it(
    'fails cleanly against an absent database: exit 1, backfill-failed message + migrate hint, empty stdout',
    async () => {
      const absent = new URL(resolveTestDatabaseUrl());
      absent.pathname = '/careerforge_fictional_absent';

      const { exitCode, stdout, stderr } = await runCli(absent.href);

      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain('quote verification backfill failed:');
      expect(stderr).toContain('pnpm db:migrate');
    },
    SPAWN_TEST_TIMEOUT,
  );
});
