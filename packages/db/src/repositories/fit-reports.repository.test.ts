import {
  FIT_DIMENSIONS,
  type FitReportData,
  type SearchCriteriaData,
  type SubScore,
} from '@careerforge/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { createExtractionsRepository } from './extractions.repository.ts';
import { createFitReportsRepository } from './fit-reports.repository.ts';
import { createPostingsRepository } from './postings.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M1-09 fit persistence path (dockerized Postgres,
// migration 0005). All fixture data fictional (RISKS P-01).

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const extractions = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

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

let seedSequence = 0;
async function seedScoredPosting() {
  seedSequence += 1;
  const user = await users.create({
    email: `fit.fictional.${String(seedSequence)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  const { posting } = await postings.ingest(user.id, {
    rawText: 'Fictional Gizmo Works hiring. Requirements: 5+ years TypeScript.',
    contentHash: String(seedSequence).padEnd(64, 'f').slice(0, 64),
    company: 'Fictional Gizmo Works',
    title: 'Senior Engineer',
    sourceNote: null,
  });
  const outcome = await extractions.persistExtraction(
    user.id,
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
        category: 'language',
        text: 'TypeScript experience',
        sourceQuote: '5+ years TypeScript',
        confidence: 0.9,
        quoteVerified: true,
      },
    ],
  );
  const run = outcome.runs[0]!;
  const requirementId = outcome.requirements[0]!.id;
  // persistExtraction flipped new -> extracted (requirement-bearing).
  return { user, posting, run, requirementId };
}

function subScores(requirementId: string): SubScore[] {
  return FIT_DIMENSIONS.map((dimension) => ({
    dimension,
    score: 0.5,
    rationale: `fictional ${dimension} rationale`,
    evidence:
      dimension === 'min_quals'
        ? [
            {
              requirementId,
              profileSkillId: null,
              profileProjectId: null,
              profileExperienceId: null,
              postingQuote: '5+ years TypeScript',
              profileQuote: 'Senior Software Engineer at Fictional Gizmo Works',
              strength: 'adjacent' as const,
            },
          ]
        : [],
  }));
}

function report(requirementId: string, over: Partial<FitReportData> = {}): FitReportData {
  return {
    verdict: 'scored',
    exclusions: [],
    subScores: subScores(requirementId),
    unscoredRequirements: [],
    forcedLowestPriority: { applied: false, matchedSlugs: [] },
    inputFlagged: false,
    ...over,
  };
}

async function postingStatus(id: string): Promise<string> {
  const { rows } = await handle.pool.query<{ status: string }>(
    'select status from job_postings where id = $1',
    [id],
  );
  return rows[0]?.status ?? 'MISSING';
}

describe('persistFitReport', () => {
  it('one tx: report + 7 sub-scores + evidence, jsonb payloads round-trip, posting flips extracted -> scored', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    expect(await postingStatus(posting.id)).toBe('extracted');

    const outcome = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId),
      CRITERIA,
    );

    expect(outcome.postingFlipped).toBe(true);
    expect(await postingStatus(posting.id)).toBe('scored');
    expect(outcome.report.verdict).toBe('scored');
    expect(outcome.report.exclusions).toEqual([]);
    expect(outcome.report.criteriaSnapshot).toEqual(CRITERIA); // A1 round-trip
    expect(outcome.report.forcedLowest).toEqual({ applied: false, matchedSlugs: [] });
    expect(outcome.report.inputFlagged).toBe(false);
    expect(outcome.report.reviewStatus).toBe('draft');
    expect(outcome.subScores).toHaveLength(7);
    expect(outcome.subScores.map((entry) => entry.subScore.dimension)).toEqual([...FIT_DIMENSIONS]);
    const minQuals = outcome.subScores[0]!;
    expect(minQuals.evidence).toHaveLength(1);
    expect(minQuals.evidence[0]).toMatchObject({
      requirementId,
      strength: 'adjacent',
      fitSubScoreId: minQuals.subScore.id,
    });
  });

  it('re-scoring APPENDS: first report untouched, flip is a no-op, latest read serves the new one', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    const first = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId),
      CRITERIA,
    );
    const second = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId, { inputFlagged: false }),
      CRITERIA,
    );

    expect(second.postingFlipped).toBe(false); // already scored — no-op
    expect(await postingStatus(posting.id)).toBe('scored');
    const { rows } = await handle.pool.query<{ n: string }>(
      'select count(*) as n from fit_reports where posting_id = $1',
      [posting.id],
    );
    expect(rows[0]?.n).toBe('2');

    const latest = await fitRepo.findLatestReport(user.id, posting.id);
    expect(latest?.report.id).toBe(second.report.id);
    expect(latest?.subScores).toHaveLength(7);
    // First report still fully present (append-only).
    expect(first.report.id).not.toBe(second.report.id);
  });

  it('mid-tx failure leaves ZERO rows and no flip (atomicity)', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    const missingRequirement = '99999999-9999-4999-8999-999999999999';
    // Evidence rows insert LAST — an FK violation there must roll back the
    // report and sub-score rows already written in this transaction.
    const poisoned = report(requirementId);
    poisoned.subScores[0]!.evidence[0]!.requirementId = missingRequirement;

    await expect(
      fitRepo.persistFitReport(user.id, posting.id, run.id, poisoned, CRITERIA),
    ).rejects.toThrow();

    const { rows } = await handle.pool.query<{ n: string }>(
      'select count(*) as n from fit_reports',
    );
    expect(rows[0]?.n).toBe('0');
    const { rows: subRows } = await handle.pool.query<{ n: string }>(
      'select count(*) as n from fit_sub_scores',
    );
    expect(subRows[0]?.n).toBe('0');
    expect(await postingStatus(posting.id)).toBe('extracted'); // no flip
  });

  it('the zod write path rejects a contract-violating payload before any row is written', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    // verdict excluded with zero exclusions violates the mirror law.
    await expect(
      fitRepo.persistFitReport(
        user.id,
        posting.id,
        run.id,
        report(requirementId, { verdict: 'excluded' }),
        CRITERIA,
      ),
    ).rejects.toThrow(/excluded exactly when exclusions/);
    const { rows } = await handle.pool.query<{ n: string }>(
      'select count(*) as n from fit_reports',
    );
    expect(rows[0]?.n).toBe('0');
  });
});

describe('DB constraints (migration 0005)', () => {
  it('score CHECK rejects out-of-range values at the DB (permanent negative pin)', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    const outcome = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId),
      CRITERIA,
    );
    await expect(
      handle.pool.query(
        `insert into fit_sub_scores (user_id, fit_report_id, dimension, score, rationale)
         values ($1, $2, 'technical', 1.5, 'fictional out-of-range')`,
        [user.id, outcome.report.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('duplicate dimension per report rejected by the unique index', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    const outcome = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId),
      CRITERIA,
    );
    await expect(
      handle.pool.query(
        `insert into fit_sub_scores (user_id, fit_report_id, dimension, score, rationale)
         values ($1, $2, 'priority', 0.5, 'fictional duplicate')`,
        [user.id, outcome.report.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('verdict and strength CHECKs reject unknown vocabulary', async () => {
    const { user, posting, run } = await seedScoredPosting();
    await expect(
      handle.pool.query(
        `insert into fit_reports (user_id, posting_id, extraction_run_id, verdict, exclusions, criteria_snapshot, forced_lowest, input_flagged)
         values ($1, $2, $3, 'maybe', '[]', '{}', '{}', false)`,
        [user.id, posting.id, run.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('findLatestReport', () => {
  it('is user-scoped and undefined when absent', async () => {
    const { user, posting } = await seedScoredPosting();
    expect(await fitRepo.findLatestReport(user.id, posting.id)).toBeUndefined();
    const stranger = await seedScoredPosting();
    expect(await fitRepo.findLatestReport(stranger.user.id, posting.id)).toBeUndefined();
  });
});

// --- M1-10 additive methods ---

describe('markReviewed (one-shot draft -> reviewed, D8)', () => {
  it('captures notes, transitions once, and CAS-rejects the second attempt', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    const { report: row } = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId),
      CRITERIA,
    );

    const first = await fitRepo.markReviewed(user.id, row.id, 'fictional review note');
    expect(first.kind).toBe('reviewed');
    if (first.kind === 'reviewed') {
      expect(first.report.reviewStatus).toBe('reviewed');
      expect(first.report.notes).toBe('fictional review note');
    }

    // Second attempt: the conditional update matches zero rows.
    const second = await fitRepo.markReviewed(user.id, row.id, 'fictional overwrite attempt');
    expect(second).toEqual({ kind: 'already_reviewed' });

    // Notes from the first review survive — never blind-overwritten.
    const latest = await fitRepo.findLatestReport(user.id, posting.id);
    expect(latest?.report.notes).toBe('fictional review note');
  });

  it('null notes are a valid review', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    const { report: row } = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId),
      CRITERIA,
    );
    const outcome = await fitRepo.markReviewed(user.id, row.id, null);
    expect(outcome.kind).toBe('reviewed');
    if (outcome.kind === 'reviewed') expect(outcome.report.notes).toBeNull();
  });

  it('missing and foreign-owned reports are the same not_found (user-scoped)', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    const { report: row } = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId),
      CRITERIA,
    );
    const stranger = await seedScoredPosting();

    expect(
      await fitRepo.markReviewed(user.id, '99999999-9999-4999-8999-999999999999', null),
    ).toEqual({ kind: 'not_found' });
    expect(await fitRepo.markReviewed(stranger.user.id, row.id, 'fictional foreign note')).toEqual({
      kind: 'not_found',
    });
    // The foreign attempt changed nothing.
    const latest = await fitRepo.findLatestReport(user.id, posting.id);
    expect(latest?.report.reviewStatus).toBe('draft');
  });

  it('report CONTENT stays append-only around the workflow transition', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    const { report: row } = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      report(requirementId),
      CRITERIA,
    );
    await fitRepo.markReviewed(user.id, row.id, 'fictional review note');
    const latest = await fitRepo.findLatestReport(user.id, posting.id);
    expect(latest?.report.verdict).toBe('scored');
    expect(latest?.report.criteriaSnapshot).toEqual(CRITERIA);
    expect(latest?.subScores).toHaveLength(7);
  });
});

describe('hasFitReport (the M1-10 unarchive widening artifact probe)', () => {
  it('false before, true after, user-scoped', async () => {
    const { user, posting, run, requirementId } = await seedScoredPosting();
    expect(await fitRepo.hasFitReport(user.id, posting.id)).toBe(false);
    await fitRepo.persistFitReport(user.id, posting.id, run.id, report(requirementId), CRITERIA);
    expect(await fitRepo.hasFitReport(user.id, posting.id)).toBe(true);
    const stranger = await seedScoredPosting();
    expect(await fitRepo.hasFitReport(stranger.user.id, posting.id)).toBe(false);
  });
});

describe('currentDate (one-clock convention)', () => {
  it('returns the DB clock date as YYYY-MM-DD — shape only, never a value pin', async () => {
    const today = await fitRepo.currentDate();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A second read stays a valid date too — no value pin (clock output;
    // equality would flake on a midnight crossing).
    expect(await fitRepo.currentDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
