import { Writable } from 'node:stream';

import {
  FIT_DIMENSIONS,
  type FitReportData,
  type MarketSignalReport,
  type SearchCriteriaData,
} from '@careerforge/core';
import {
  createExtractionsRepository,
  createFitReportsRepository,
  createPostingsRepository,
} from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';
import { MARKET_SIGNAL_HONESTY } from '@careerforge/scoring';
import { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

// GET /market-signal (M9-02). The route-level D8 pin: seeded postings/reports/gaps
// through the REAL endpoint reproduce the pure module's bucket assignment + the
// honesty string verbatim, so wiring cannot silently diverge. Never-trust-the-client
// (D7): a doctored query has zero effect. Value-free logs (counts only). All fixtures
// fictional (RISKS P-01).

const handle = createTestDb();
const env = buildTestEnv();
const postingsRepo = createPostingsRepository(handle.db);
const extractionsRepo = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);

const instances: FastifyInstance[] = [];

beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await Promise.all(instances.map((instance) => instance.close()));
  instances.length = 0;
});
afterAll(() => handle.pool.end());

async function buildAt(deps: AppDeps = {}): Promise<FastifyInstance> {
  const instance = await buildApp(env, { dbHandle: handle, ...deps });
  instances.push(instance);
  return instance;
}

type Headers = { cookie: string };
let seq = 0;

async function makeUser(): Promise<{ userId: string; headers: Headers }> {
  seq += 1;
  const user = await createTestUser(handle, {
    email: `market.${seq}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id, new Date('2031-01-01T00:00:00Z'));
  return { userId: user.id, headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } };
}

const CRITERIA: SearchCriteriaData = {
  hardFilters: { employment_type: ['contract'] },
  positiveSignals: {
    role: ['senior'],
    technologies: ['typescript'],
    problem_domains: ['event_driven'],
    work_arrangement: ['remote'],
    scope: ['platform'],
  },
  negativeSignals: ['gamedev_crunch'],
  forceLowestPriority: { industry: ['defense'] },
  compBounds: { currency: 'usd', base_preferred_min: 150_000, base_preferred_max: 190_000 },
};

function reportData(): FitReportData {
  return {
    verdict: 'scored',
    exclusions: [],
    subScores: FIT_DIMENSIONS.map((dimension) => ({
      dimension,
      score: 0.5,
      rationale: `fictional ${dimension} rationale`,
      evidence: [],
    })),
    unscoredRequirements: [],
    forcedLowestPriority: { applied: false, matchedSlugs: [] },
    inputFlagged: false,
  };
}

let hashSeed = 1000;
async function seedPostingWithGap(userId: string, requirementText: string): Promise<void> {
  hashSeed += 1;
  const { posting } = await postingsRepo.ingest(userId, {
    rawText: `Fictional posting ${String(hashSeed)} requirements.`,
    contentHash: String(hashSeed).padEnd(64, 'e').slice(0, 64),
    company: 'Fictional Co',
    title: 'Engineer',
    sourceNote: null,
  });
  const extraction = await extractionsRepo.persistExtraction(
    userId,
    posting.id,
    [
      {
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
      },
    ],
    [
      {
        kind: 'must_have',
        category: 'other',
        text: requirementText,
        sourceQuote: `quote: ${requirementText}`,
        confidence: 0.9,
        quoteVerified: true,
      },
    ],
  );
  const run = extraction.runs[0];
  const req = extraction.requirements[0];
  if (!run || !req) throw new Error('seed produced no run/requirement');
  await fitRepo.persistFitReport(userId, posting.id, run.id, reportData(), CRITERIA, [
    { requirementId: req.id, classification: 'genuine_gap', rationale: 'No named-skill evidence.' },
  ]);
}

async function getSignal(
  instance: FastifyInstance,
  headers: Headers,
  query = '',
): Promise<{ statusCode: number; body: MarketSignalReport }> {
  const res = await instance.inject({ method: 'GET', url: `/market-signal${query}`, headers });
  return { statusCode: res.statusCode, body: res.json<MarketSignalReport>() };
}

describe('GET /market-signal', () => {
  it('route reproduces the pure bucket assignment + honesty verbatim (D8 pin)', async () => {
    const instance = await buildAt();
    const { userId, headers } = await makeUser();
    // Two non-excluded postings demanding a certification -> Certify (>= 2 postings).
    await seedPostingWithGap(userId, 'AWS Certification required');
    await seedPostingWithGap(userId, 'AWS Certification required');

    const { statusCode, body } = await getSignal(instance, headers);
    expect(statusCode).toBe(200);
    expect(body.honesty).toBe(MARKET_SIGNAL_HONESTY);
    expect(body.scorerVersion).toBe(1);
    expect(body.groupCount).toBe(1);
    expect(body.instanceCount).toBe(2);
    expect(body.buckets.certify).toHaveLength(1);
    expect(body.buckets.build).toHaveLength(0);
    const [group] = body.buckets.certify;
    expect(group?.key).toBe('AWS Certification required');
    expect(group?.postingCount).toBe(2);
    expect(group?.certification).toEqual({
      mentioned: true,
      postingCount: 2,
      matchedTerms: ['certification'],
    });
    expect(body.cohort.postingsConsidered).toBe(2);
    expect(body.cohort.postingsWithSignal).toBe(2);
  });

  it('401 without a session', async () => {
    const instance = await buildAt();
    const res = await instance.inject({ method: 'GET', url: '/market-signal' });
    expect(res.statusCode).toBe(401);
  });

  it('ignores doctored query params (never-trust-the-client)', async () => {
    const instance = await buildAt();
    const { userId, headers } = await makeUser();
    await seedPostingWithGap(userId, 'Kubernetes operations');
    const clean = await getSignal(instance, headers);
    const doctored = await getSignal(
      instance,
      headers,
      '?userId=99999999-9999-4999-8999-999999999999&limit=0',
    );
    expect(doctored.statusCode).toBe(200);
    expect(doctored.body).toEqual(clean.body);
  });

  it('empty cohort is a valid 200 with zeroed counts', async () => {
    const instance = await buildAt();
    const { headers } = await makeUser();
    const { statusCode, body } = await getSignal(instance, headers);
    expect(statusCode).toBe(200);
    expect(body.groupCount).toBe(0);
    expect(body.instanceCount).toBe(0);
    expect(body.buckets).toEqual({ sharpen: [], prove: [], build: [], certify: [] });
    expect(body.noAction).toEqual([]);
    expect(body.cohort).toEqual({
      postingsConsidered: 0,
      postingsWithSignal: 0,
      postingsWithoutReport: 0,
      postingsArchived: 0,
      excludedVerdictPostings: 0,
      draftReports: 0,
      reviewedReports: 0,
      unscoredRequirementsInCohort: 0,
    });
  });

  it('logs counts ONLY - never requirement text, keys, or matched terms', async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString('utf8'));
        cb();
      },
    });
    // Build at info level (the shared env is 'fatal' to keep test output quiet).
    const instance = await buildApp(buildTestEnv({ LOG_LEVEL: 'info' }), {
      dbHandle: handle,
      logStream,
    });
    instances.push(instance);
    const { userId, headers } = await makeUser();
    await seedPostingWithGap(userId, 'Kubernetes cluster operations');
    expect((await getSignal(instance, headers)).statusCode).toBe(200);

    const logLine = lines.find((line) => line.includes('market signal read'));
    expect(logLine).toBeDefined();
    const parsed = JSON.parse(logLine as string) as Record<string, unknown>;
    expect(typeof parsed.groups).toBe('number');
    expect(typeof parsed.build).toBe('number');
    expect(typeof parsed.postingsWithSignal).toBe('number');
    // Value-free: no posting-derived text on the wire-to-logs path.
    expect(logLine).not.toContain('Kubernetes');
    expect(logLine).not.toContain('cluster operations');
  });
});
