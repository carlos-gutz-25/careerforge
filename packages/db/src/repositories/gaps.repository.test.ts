import {
  FIT_DIMENSIONS,
  type FitReportData,
  type GapAssignment,
  type SearchCriteriaData,
} from '@careerforge/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { createExtractionsRepository } from './extractions.repository.ts';
import { createFitReportsRepository, type FitPersistOutcome } from './fit-reports.repository.ts';
import { createGapsRepository } from './gaps.repository.ts';
import { createPostingsRepository } from './postings.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M1-11 gap persistence + carry path (dockerized
// Postgres, migration 0006). All fixture data fictional (RISKS P-01).

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const extractions = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);
const gapsRepo = createGapsRepository(handle.db);

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

async function seedUserAndPosting() {
  seedSequence += 1;
  const user = await users.create({
    email: `gaps.fictional.${String(seedSequence)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  const { posting } = await postings.ingest(user.id, {
    rawText: 'Fictional Gizmo Works hiring. Requirements: 5+ years TypeScript. Kubernetes.',
    contentHash: String(seedSequence).padEnd(64, 'e').slice(0, 64),
    company: 'Fictional Gizmo Works',
    title: 'Senior Engineer',
    sourceNote: null,
  });
  return { user, posting };
}

async function extractRun(userId: string, postingId: string, texts: string[]) {
  const outcome = await extractions.persistExtraction(
    userId,
    postingId,
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
    texts.map((text) => ({
      kind: 'must_have' as const,
      category: 'other' as const,
      text,
      sourceQuote: `quote: ${text}`,
      confidence: 0.9,
      quoteVerified: true,
    })),
  );
  const run = outcome.runs[0];
  if (!run) throw new Error('seed produced no run');
  return { run, requirements: outcome.requirements };
}

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

function assignmentsFor(requirements: readonly { id: string }[]): GapAssignment[] {
  return requirements.map((row) => ({
    requirementId: row.id,
    classification: 'genuine_gap' as const,
    rationale: 'No named-skill evidence.',
  }));
}

async function persistReport(
  userId: string,
  postingId: string,
  runId: string,
  assignments: GapAssignment[],
): Promise<FitPersistOutcome> {
  return fitRepo.persistFitReport(userId, postingId, runId, reportData(), CRITERIA, assignments);
}

describe('persistFitReport gap sets', () => {
  it('inserts one gap row per assignment, fresh engine state, canonical read order + join fields', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, [
      'Kubernetes cluster operations',
      'TypeScript expertise',
    ]);
    const outcome = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));

    expect(outcome.gaps).toHaveLength(2);
    for (const gap of outcome.gaps) {
      expect(gap.userOverridden).toBe(false);
      expect(gap.overrideNote).toBeNull();
      expect(gap.carriedVia).toBeNull();
      expect(gap.classification).toBe('genuine_gap');
      expect(gap.engineClassification).toBe('genuine_gap');
    }

    const read = await gapsRepo.findGapsForReport(user.id, outcome.report.id);
    expect(read).toBeDefined();
    expect(read?.lostOverrides).toBe(0);
    expect(read?.rows.map((row) => row.gap.requirementId)).toEqual(
      requirements.map((row) => row.id),
    );
    expect(read?.rows[0]).toMatchObject({
      requirementText: 'Kubernetes cluster operations',
      requirementKind: 'must_have',
      requirementCategory: 'other',
    });
  });

  it('R3: a report persisted with zero assignments serves rows [] and lostOverrides 0', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run } = await extractRun(user.id, posting.id, ['Anything fictional']);
    const outcome = await persistReport(user.id, posting.id, run.id, []);
    expect(outcome.gaps).toEqual([]);
    expect(await gapsRepo.findGapsForReport(user.id, outcome.report.id)).toEqual({
      rows: [],
      lostOverrides: 0,
    });
  });

  it('missing and foreign-owned reports are the same undefined outcome', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Fictional text']);
    const outcome = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    expect(
      await gapsRepo.findGapsForReport(user.id, '99999999-9999-4999-8999-999999999999'),
    ).toBeUndefined();
    const stranger = await users.create({
      email: `gaps.stranger.${String(seedSequence)}@example.com`,
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    expect(await gapsRepo.findGapsForReport(stranger.id, outcome.report.id)).toBeUndefined();
  });

  it('mid-tx FK failure on the LAST insert group (gaps) leaves ZERO rows and no flip', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Fictional text']);
    const poisoned = [
      ...assignmentsFor(requirements),
      {
        requirementId: '99999999-9999-4999-8999-999999999999',
        classification: 'genuine_gap' as const,
        rationale: 'poisoned row',
      },
    ];
    await expect(persistReport(user.id, posting.id, run.id, poisoned)).rejects.toThrow();
    const counts = await handle.pool.query<{ reports: string; gaps: string; status: string }>(
      `select
         (select count(*) from fit_reports) as reports,
         (select count(*) from gaps) as gaps,
         (select status from job_postings where id = $1) as status`,
      [posting.id],
    );
    expect(counts.rows[0]).toEqual({ reports: '0', gaps: '0', status: 'extracted' });
  });
});

describe('override carry-forward (A1: prior-report-only)', () => {
  it('an override survives a re-score via requirement_id, engine values stay fresh', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, [
      'Kubernetes cluster operations',
      'TypeScript expertise',
    ]);
    const first = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    const target = first.gaps[0];
    if (!target) throw new Error('seed produced no gap row');

    const overridden = await gapsRepo.overrideGap(user.id, target.id, 'have', 'fictional why');
    expect(overridden?.gap).toMatchObject({
      classification: 'have',
      engineClassification: 'genuine_gap',
      userOverridden: true,
      overrideNote: 'fictional why',
      carriedVia: null,
    });

    const second = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    const carried = second.gaps.find((gap) => gap.requirementId === target.requirementId);
    expect(carried).toMatchObject({
      classification: 'have',
      engineClassification: 'genuine_gap',
      rationale: 'No named-skill evidence.',
      userOverridden: true,
      overrideNote: 'fictional why',
      carriedVia: 'requirement_id',
    });
    const untouched = second.gaps.find((gap) => gap.requirementId !== target.requirementId);
    expect(untouched).toMatchObject({ userOverridden: false, carriedVia: null });
  });

  it('t4 transitivity: override -> re-score -> re-score, each hop from its immediate predecessor', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Fictional text']);
    const first = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    await gapsRepo.overrideGap(user.id, first.gaps[0]!.id, 'low_priority', null);
    const second = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    expect(second.gaps[0]).toMatchObject({ userOverridden: true, carriedVia: 'requirement_id' });
    const third = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    expect(third.gaps[0]).toMatchObject({
      classification: 'low_priority',
      userOverridden: true,
      carriedVia: 'requirement_id',
    });
  });

  it('t1 NO RESURRECTION: un-override on the latest report is final across the next re-score', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Fictional text']);
    const first = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    await gapsRepo.overrideGap(user.id, first.gaps[0]!.id, 'have', 'to be reverted');
    const second = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    expect(second.gaps[0]).toMatchObject({ userOverridden: true, classification: 'have' });

    const reverted = await gapsRepo.overrideGap(user.id, second.gaps[0]!.id, null, null);
    expect(reverted?.gap).toMatchObject({
      classification: 'genuine_gap',
      userOverridden: false,
      overrideNote: null,
      carriedVia: null,
    });

    // The first report's overridden row STILL EXISTS (append-only history)
    // — but the next persist consults only the latest report (A1).
    const third = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    expect(third.gaps[0]).toMatchObject({
      classification: 'genuine_gap',
      userOverridden: false,
      overrideNote: null,
      carriedVia: null,
    });
  });

  it('re-extraction: one-to-one content match carries via content; vanished text is lost, loudly', async () => {
    const { user, posting } = await seedUserAndPosting();
    const runA = await extractRun(user.id, posting.id, [
      'Kubernetes  cluster   operations',
      'Vanishing requirement wording',
    ]);
    const first = await persistReport(
      user.id,
      posting.id,
      runA.run.id,
      assignmentsFor(runA.requirements),
    );
    await gapsRepo.overrideGap(user.id, first.gaps[0]!.id, 'needs_refresh', 'carried note');
    await gapsRepo.overrideGap(user.id, first.gaps[1]!.id, 'have', 'this one will be lost');

    // New extraction run: same normalized text for the first requirement
    // (different whitespace, NEW id), the second requirement gone.
    const runB = await extractRun(user.id, posting.id, [
      'Kubernetes cluster operations',
      'Entirely new requirement',
    ]);
    const second = await persistReport(
      user.id,
      posting.id,
      runB.run.id,
      assignmentsFor(runB.requirements),
    );

    const carried = second.gaps.find((gap) => gap.requirementId === runB.requirements[0]!.id);
    expect(carried).toMatchObject({
      classification: 'needs_refresh',
      engineClassification: 'genuine_gap',
      userOverridden: true,
      overrideNote: 'carried note',
      carriedVia: 'content',
    });

    const read = await gapsRepo.findGapsForReport(user.id, second.report.id);
    expect(read?.lostOverrides).toBe(1); // read = complement of write (A1)
  });

  it('t2: duplicate normalized text among the NEW requirements => no carry', async () => {
    const { user, posting } = await seedUserAndPosting();
    const runA = await extractRun(user.id, posting.id, ['Ambiguous requirement text']);
    const first = await persistReport(
      user.id,
      posting.id,
      runA.run.id,
      assignmentsFor(runA.requirements),
    );
    await gapsRepo.overrideGap(user.id, first.gaps[0]!.id, 'have', null);

    const runB = await extractRun(user.id, posting.id, [
      'Ambiguous requirement text',
      'Ambiguous  requirement text',
    ]);
    const second = await persistReport(
      user.id,
      posting.id,
      runB.run.id,
      assignmentsFor(runB.requirements),
    );
    expect(second.gaps.every((gap) => !gap.userOverridden && gap.carriedVia === null)).toBe(true);
    const read = await gapsRepo.findGapsForReport(user.id, second.report.id);
    expect(read?.lostOverrides).toBe(1);
  });

  it('t3: two distinct prior overridden requirements sharing normalized text => no carry', async () => {
    const { user, posting } = await seedUserAndPosting();
    const runA = await extractRun(user.id, posting.id, [
      'Shared requirement text',
      'Shared  requirement  text',
    ]);
    const first = await persistReport(
      user.id,
      posting.id,
      runA.run.id,
      assignmentsFor(runA.requirements),
    );
    await gapsRepo.overrideGap(user.id, first.gaps[0]!.id, 'have', null);
    await gapsRepo.overrideGap(user.id, first.gaps[1]!.id, 'low_priority', null);

    const runB = await extractRun(user.id, posting.id, ['Shared requirement text']);
    const second = await persistReport(
      user.id,
      posting.id,
      runB.run.id,
      assignmentsFor(runB.requirements),
    );
    expect(second.gaps[0]).toMatchObject({ userOverridden: false, carriedVia: null });
    const read = await gapsRepo.findGapsForReport(user.id, second.report.id);
    expect(read?.lostOverrides).toBe(2);
  });
});

describe('overrideGap (A2 full replacement)', () => {
  async function seedOneGap() {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Fictional text']);
    const outcome = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    const gap = outcome.gaps[0];
    if (!gap) throw new Error('seed produced no gap row');
    return { user, gap };
  }

  it('replaces the note on every PATCH — a second override with a new note wins outright', async () => {
    const { user, gap } = await seedOneGap();
    await gapsRepo.overrideGap(user.id, gap.id, 'have', 'first note');
    const second = await gapsRepo.overrideGap(user.id, gap.id, 'needs_refresh', 'second note');
    expect(second?.gap).toMatchObject({
      classification: 'needs_refresh',
      overrideNote: 'second note',
      userOverridden: true,
    });
  });

  it('note null on an override CLEARS the stored note (no merge-patch)', async () => {
    const { user, gap } = await seedOneGap();
    await gapsRepo.overrideGap(user.id, gap.id, 'have', 'will be cleared');
    const cleared = await gapsRepo.overrideGap(user.id, gap.id, 'have', null);
    expect(cleared?.gap).toMatchObject({
      classification: 'have',
      overrideNote: null,
      userOverridden: true,
    });
  });

  it('classification null is the D6 un-override: revert to engine, note cleared', async () => {
    const { user, gap } = await seedOneGap();
    await gapsRepo.overrideGap(user.id, gap.id, 'have', 'why note');
    const reverted = await gapsRepo.overrideGap(user.id, gap.id, null, null);
    expect(reverted?.gap).toMatchObject({
      classification: gap.engineClassification,
      userOverridden: false,
      overrideNote: null,
      carriedVia: null,
    });
  });

  it('override to the SAME value as the engine still records user_overridden', async () => {
    const { user, gap } = await seedOneGap();
    const same = await gapsRepo.overrideGap(user.id, gap.id, gap.engineClassification, null);
    expect(same?.gap).toMatchObject({
      classification: gap.engineClassification,
      userOverridden: true,
    });
  });

  it('a direct PATCH clears carried_via (NULL = direct user action)', async () => {
    const { user, gap } = await seedOneGap();
    await handle.pool.query(`update gaps set carried_via = 'requirement_id' where id = $1`, [
      gap.id,
    ]);
    const patched = await gapsRepo.overrideGap(user.id, gap.id, 'have', null);
    expect(patched?.gap.carriedVia).toBeNull();
  });

  it('missing and foreign-owned rows are the same undefined outcome', async () => {
    const { user, gap } = await seedOneGap();
    expect(
      await gapsRepo.overrideGap(user.id, '99999999-9999-4999-8999-999999999999', 'have', null),
    ).toBeUndefined();
    const stranger = await users.create({
      email: `gaps.stranger2.${String(seedSequence)}@example.com`,
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    expect(await gapsRepo.overrideGap(stranger.id, gap.id, 'have', null)).toBeUndefined();
  });
});

describe('DB constraint pins (permanent negatives)', () => {
  async function seedOneGap() {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Fictional text']);
    const outcome = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    return { user, report: outcome.report, gap: outcome.gaps[0]! };
  }

  it('23514: a sixth bucket is rejected by gaps_classification_check', async () => {
    const { gap } = await seedOneGap();
    try {
      await handle.pool.query(`update gaps set classification = 'wont_fix' where id = $1`, [
        gap.id,
      ]);
      expect.unreachable('update must violate gaps_classification_check');
    } catch (error) {
      expect(pgErrorCode(error)).toBe('23514');
    }
  });

  it('23514: engine_classification and carried_via are equally pinned', async () => {
    const { gap } = await seedOneGap();
    try {
      await handle.pool.query(`update gaps set engine_classification = 'wont_fix' where id = $1`, [
        gap.id,
      ]);
      expect.unreachable('update must violate gaps_engine_classification_check');
    } catch (error) {
      expect(pgErrorCode(error)).toBe('23514');
    }
    try {
      await handle.pool.query(`update gaps set carried_via = 'history' where id = $1`, [gap.id]);
      expect.unreachable('update must violate gaps_carried_via_check');
    } catch (error) {
      expect(pgErrorCode(error)).toBe('23514');
    }
  });

  it('23505: one classification per requirement per report', async () => {
    const { gap } = await seedOneGap();
    try {
      await handle.pool.query(
        `insert into gaps (user_id, fit_report_id, requirement_id, classification, engine_classification, rationale)
         values ($1, $2, $3, 'have', 'have', 'duplicate row')`,
        [gap.userId, gap.fitReportId, gap.requirementId],
      );
      expect.unreachable('insert must violate gaps_report_requirement_unique');
    } catch (error) {
      expect(pgErrorCode(error)).toBe('23505');
    }
  });
});

// M9-02: the market-signal reads (D9). Latest-report-only, non-archived,
// user-scoped; evidence strengths aggregated per (report, requirement); the D5
// cohort counts. All fixtures fictional (RISKS P-01). Some report states (excluded
// verdict, an unverified requirement) are seeded by direct SQL UPDATE after the
// normal persist - the M6-06 precedent (persistFitReport's zod write path forbids
// them, and the read under test only consumes the resulting columns).
describe('M9-02 market-signal reads', () => {
  async function setReportCreatedAt(reportId: string, iso: string): Promise<void> {
    await handle.pool.query(`update fit_reports set created_at = $2 where id = $1`, [
      reportId,
      iso,
    ]);
  }

  it('returns one instance per gap on the latest report, user-scoped, ordered', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, [
      'Kubernetes cluster operations',
      'TypeScript expertise',
    ]);
    const outcome = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));

    const rows = await gapsRepo.listMarketSignalRows(user.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.requirementText)).toEqual([
      'Kubernetes cluster operations',
      'TypeScript expertise',
    ]);
    expect(rows[0]).toMatchObject({
      postingId: posting.id,
      fitReportId: outcome.report.id,
      reportVerdict: 'scored',
      reportReviewStatus: 'draft',
      kind: 'must_have',
      category: 'other',
      classification: 'genuine_gap',
      userOverridden: false,
      evidenceStrengths: [],
    });

    const stranger = await users.create({
      email: `ms.stranger.${String(seedSequence)}@example.com`,
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    expect(await gapsRepo.listMarketSignalRows(stranger.id)).toEqual([]);
  });

  it('reads ONLY the latest report per posting (older report gaps invisible)', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Kubernetes operations']);
    const older = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    await setReportCreatedAt(older.report.id, '2020-01-01T00:00:00.000Z');
    const newer = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));

    const rows = await gapsRepo.listMarketSignalRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fitReportId).toBe(newer.report.id);
  });

  it('excludes archived postings from the rows', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Kubernetes operations']);
    await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    await handle.pool.query(`update job_postings set status = 'archived' where id = $1`, [
      posting.id,
    ]);
    expect(await gapsRepo.listMarketSignalRows(user.id)).toEqual([]);
  });

  it('aggregates evidence strengths per requirement (and empty when none)', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, [
      'Kubernetes operations',
      'TypeScript expertise',
    ]);
    const outcome = await persistReport(user.id, posting.id, run.id, assignmentsFor(requirements));
    const withEvidence = requirements[0];
    if (!withEvidence) throw new Error('seed produced no requirement');
    // Seed an evidence link directly: the zod write path requires a real profile FK
    // for a `direct` strength, but the read under test only consumes the strength
    // column joined via its sub-score's report (the M6-06 SQL-seed precedent).
    const subScore = await handle.pool.query<{ id: string }>(
      `select id from fit_sub_scores where fit_report_id = $1 limit 1`,
      [outcome.report.id],
    );
    const subScoreId = subScore.rows[0]?.id;
    if (!subScoreId) throw new Error('no sub-score to anchor evidence');
    await handle.pool.query(
      `insert into evidence_links (user_id, fit_sub_score_id, requirement_id, posting_quote, profile_quote, strength)
       values ($1, $2, $3, 'fictional posting quote', 'fictional profile quote', 'direct')`,
      [user.id, subScoreId, withEvidence.id],
    );

    const rows = await gapsRepo.listMarketSignalRows(user.id);
    const evidenced = rows.find((row) => row.requirementId === withEvidence.id);
    const bare = rows.find((row) => row.requirementId !== withEvidence.id);
    expect(evidenced?.evidenceStrengths).toEqual(['direct']);
    expect(bare?.evidenceStrengths).toEqual([]);
  });

  it('countMarketSignalCohort discloses every posting class row-by-row', async () => {
    const user = await users.create({
      email: `ms.cohort.${String((seedSequence += 1))}@example.com`,
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    async function postingFor(hashSeed: number): Promise<string> {
      const { posting } = await postings.ingest(user.id, {
        rawText: `Fictional posting ${String(hashSeed)} requirements.`,
        contentHash: String(hashSeed).padEnd(64, 'e').slice(0, 64),
        company: 'Fictional Co',
        title: 'Engineer',
        sourceNote: null,
      });
      return posting.id;
    }

    // P1: scored + draft report, one requirement later marked unverified.
    const p1 = await postingFor(9001);
    const r1 = await extractRun(user.id, p1, ['Kubernetes', 'TypeScript']);
    await persistReport(user.id, p1, r1.run.id, assignmentsFor(r1.requirements));
    await handle.pool.query(`update requirements set quote_verified = false where id = $1`, [
      r1.requirements[0]?.id,
    ]);

    // P2: excluded + reviewed report.
    const p2 = await postingFor(9002);
    const r2 = await extractRun(user.id, p2, ['Docker']);
    const rep2 = await persistReport(user.id, p2, r2.run.id, assignmentsFor(r2.requirements));
    await fitRepo.markReviewed(user.id, rep2.report.id, null);
    await handle.pool.query(`update fit_reports set verdict = 'excluded' where id = $1`, [
      rep2.report.id,
    ]);

    // P3: extracted, NO fit report.
    const p3 = await postingFor(9003);
    await extractRun(user.id, p3, ['Redis']);

    // P4: archived (excluded from the cohort by design).
    const p4 = await postingFor(9004);
    await handle.pool.query(`update job_postings set status = 'archived' where id = $1`, [p4]);

    const cohort = await gapsRepo.countMarketSignalCohort(user.id);
    expect(cohort).toEqual({
      postingsConsidered: 3,
      postingsWithoutReport: 1,
      postingsArchived: 1,
      excludedVerdictPostings: 1,
      draftReports: 1,
      reviewedReports: 1,
      unscoredRequirementsInCohort: 1,
    });
  });

  it('empty cohort for a user with no postings', async () => {
    const user = await users.create({
      email: `ms.empty.${String((seedSequence += 1))}@example.com`,
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    expect(await gapsRepo.listMarketSignalRows(user.id)).toEqual([]);
    expect(await gapsRepo.countMarketSignalCohort(user.id)).toEqual({
      postingsConsidered: 0,
      postingsWithoutReport: 0,
      postingsArchived: 0,
      excludedVerdictPostings: 0,
      draftReports: 0,
      reviewedReports: 0,
      unscoredRequirementsInCohort: 0,
    });
  });
});
