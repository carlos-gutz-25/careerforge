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
