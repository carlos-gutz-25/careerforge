import {
  FIT_DIMENSIONS,
  type FitReportData,
  type GapAssignment,
  type SearchCriteriaData,
} from '@careerforge/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { createExtractionsRepository } from './extractions.repository.ts';
import { createFitReportsRepository } from './fit-reports.repository.ts';
import {
  createImprovementPlansRepository,
  derivePlanRunStatus,
  type PlanDraftingRunInsert,
} from './improvement-plans.repository.ts';
import { createPostingsRepository } from './postings.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M1-12 plan persistence path (dockerized
// Postgres, migration 0007). All fixture data fictional (RISKS P-01).

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const extractions = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);
const plansRepo = createImprovementPlansRepository(handle.db);

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
    email: `plans.fictional.${String(seedSequence)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  const { posting } = await postings.ingest(user.id, {
    rawText: 'Fictional Gizmo Works hiring. Requirements: 5+ years TypeScript. Kubernetes.',
    contentHash: String(seedSequence).padEnd(64, 'f').slice(0, 64),
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
        createdAt: new Date('2026-07-19T09:00:00.000Z'),
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

function assignmentsFor(rows: readonly { id: string }[]): GapAssignment[] {
  return rows.map((row) => ({
    requirementId: row.id,
    classification: 'genuine_gap' as const,
    rationale: 'No named-skill evidence.',
  }));
}

/** Seed a full user → posting → extraction → report → gaps chain and return
 *  the pieces plan persistence needs. */
async function seedReportWithGaps(texts = ['Kubernetes cluster operations', 'TypeScript']) {
  const { user, posting } = await seedUserAndPosting();
  const { run, requirements } = await extractRun(user.id, posting.id, texts);
  const outcome = await fitRepo.persistFitReport(
    user.id,
    posting.id,
    run.id,
    reportData(),
    CRITERIA,
    assignmentsFor(requirements),
  );
  return { user, posting, report: outcome.report, gaps: outcome.gaps };
}

function runInsert(overrides: Partial<PlanDraftingRunInsert> = {}): PlanDraftingRunInsert {
  return {
    promptId: 'improvement-plan@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    rawResponse: { mock: true },
    inputTokens: 2000,
    outputTokens: 600,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 4000,
    attempt: 1,
    status: 'ok',
    createdAt: new Date('2026-07-19T10:00:00.000Z'),
    ...overrides,
  };
}

describe('derivePlanRunStatus (single policy site)', () => {
  it('flags only an ok run with a failed citation; non-ok passes through', () => {
    expect(derivePlanRunStatus('ok', true)).toBe('flagged');
    expect(derivePlanRunStatus('ok', false)).toBe('ok');
    expect(derivePlanRunStatus('schema_failed', true)).toBe('schema_failed');
    expect(derivePlanRunStatus('refusal', false)).toBe('refusal');
  });
});

describe('persistDraftingOutcome', () => {
  it('one transaction: runs + plan + items with array-order positions; findPlanForReport joins live gap fields', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');

    const outcome = await plansRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      [
        { gapId: gapA.id, action: 'Ship a fictional k8s lab writeup.', priority: 'high' },
        { gapId: gapB.id, action: 'Publish a typed API kata.', priority: 'medium' },
        { gapId: gapA.id, action: 'Second action citing the same gap.', priority: 'low' },
      ],
    );
    expect(outcome.planCreated).toBe(true);
    expect(outcome.conflicted).toBe(false);
    expect(outcome.runs).toHaveLength(1);
    expect(outcome.runs[0]?.status).toBe('ok');

    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    expect(stored).toBeDefined();
    expect(stored?.plan.reviewStatus).toBe('draft');
    expect(stored?.plan.draftingRunId).toBe(outcome.runs[0]?.id);
    expect(stored?.run.id).toBe(outcome.runs[0]?.id);
    expect(stored?.items.map((row) => row.item.position)).toEqual([0, 1, 2]);
    expect(stored?.items.map((row) => row.item.status)).toEqual(['planned', 'planned', 'planned']);
    // Many items may cite one gap (||--o{) — and every join carries the
    // requirement display fields.
    expect(stored?.items[0]?.item.gapId).toBe(gapA.id);
    expect(stored?.items[2]?.item.gapId).toBe(gapA.id);
    expect(stored?.items[0]?.gapClassification).toBe('genuine_gap');
    expect(stored?.items[0]?.requirementText).toBe('Kubernetes cluster operations');
    expect(stored?.items[0]?.requirementKind).toBe('must_have');
  });

  it('retry pair: schema_failed attempt 1 + ok attempt 2 = two audit rows, one plan', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const gapA = gaps[0];
    if (!gapA) throw new Error('seed produced no gaps');

    const outcome = await plansRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [
        runInsert({ status: 'schema_failed', attempt: 1 }),
        runInsert({ attempt: 2, createdAt: new Date('2026-07-19T10:00:10.000Z') }),
      ],
      false,
      [{ gapId: gapA.id, action: 'One clean action.', priority: 'high' }],
    );
    expect(outcome.runs.map((row) => row.status)).toEqual(['schema_failed', 'ok']);
    expect(outcome.planCreated).toBe(true);

    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    // R2: the plan's run is the ok attempt-2 call it was parsed from.
    expect(stored?.run.attempt).toBe(2);
  });

  it('citation failure: final run stored flagged, NO plan row, latest-run read serves it', async () => {
    const { user, report } = await seedReportWithGaps();

    const outcome = await plansRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      true,
      undefined,
    );
    expect(outcome.runs[0]?.status).toBe('flagged');
    expect(outcome.planCreated).toBe(false);

    expect(await plansRepo.findPlanForReport(user.id, report.id)).toBeUndefined();
    const latest = await plansRepo.findLatestRunForReport(user.id, report.id);
    expect(latest?.status).toBe('flagged');
  });

  it('non-ok terminal (no items): runs recorded, no plan', async () => {
    const { user, report } = await seedReportWithGaps();
    const outcome = await plansRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert({ status: 'refusal' })],
      false,
      undefined,
    );
    expect(outcome.runs[0]?.status).toBe('refusal');
    expect(outcome.planCreated).toBe(false);
    expect(await plansRepo.findPlanForReport(user.id, report.id)).toBeUndefined();
  });

  it('UNIQUE race: second persist commits its run but reports conflicted, first plan stands', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const gapA = gaps[0];
    if (!gapA) throw new Error('seed produced no gaps');

    const first = await plansRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      { gapId: gapA.id, action: 'Winner action.', priority: 'high' },
    ]);
    const second = await plansRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert({ createdAt: new Date('2026-07-19T10:00:20.000Z') })],
      false,
      [{ gapId: gapA.id, action: 'Loser action that must not land.', priority: 'low' }],
    );
    expect(first.planCreated).toBe(true);
    expect(second.planCreated).toBe(false);
    expect(second.conflicted).toBe(true);

    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    expect(stored?.plan.draftingRunId).toBe(first.runs[0]?.id);
    expect(stored?.items).toHaveLength(1);
    expect(stored?.items[0]?.item.action).toBe('Winner action.');
    // Honest telemetry: BOTH wire calls are in the audit table.
    const latest = await plansRepo.findLatestRunForReport(user.id, report.id);
    expect(latest?.id).toBe(second.runs[0]?.id);
  });

  it('rejects an empty run list and items on a non-ok final run', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const gapA = gaps[0];
    if (!gapA) throw new Error('seed produced no gaps');

    await expect(
      plansRepo.persistDraftingOutcome(user.id, report.id, [], false, undefined),
    ).rejects.toThrow('at least one run');
    await expect(
      plansRepo.persistDraftingOutcome(
        user.id,
        report.id,
        [runInsert({ status: 'schema_failed' })],
        false,
        [{ gapId: gapA.id, action: 'Must not land.', priority: 'high' }],
      ),
    ).rejects.toThrow('ok, citation-valid');
  });
});

describe('markPlanReviewed (one-shot CAS)', () => {
  it('reviews once with notes, 409s the second attempt, 404s the unknown and the foreign', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const gapA = gaps[0];
    if (!gapA) throw new Error('seed produced no gaps');
    await plansRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      { gapId: gapA.id, action: 'Reviewable action.', priority: 'high' },
    ]);
    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    if (!stored) throw new Error('plan missing after persist');

    const first = await plansRepo.markPlanReviewed(user.id, stored.plan.id, 'Looks right.');
    expect(first.kind).toBe('reviewed');
    if (first.kind === 'reviewed') {
      expect(first.plan.reviewStatus).toBe('reviewed');
      expect(first.plan.notes).toBe('Looks right.');
    }

    expect((await plansRepo.markPlanReviewed(user.id, stored.plan.id, null)).kind).toBe(
      'already_reviewed',
    );
    expect(
      (await plansRepo.markPlanReviewed(user.id, '99999999-9999-4999-8999-999999999999', null))
        .kind,
    ).toBe('not_found');

    const { user: stranger } = await seedReportWithGaps();
    expect((await plansRepo.markPlanReviewed(stranger.id, stored.plan.id, null)).kind).toBe(
      'not_found',
    );
  });
});

describe('updatePlanItem (A2 full replacement)', () => {
  it('replaces status + priority, leaves action/gap/position untouched, joins display fields', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const gapA = gaps[0];
    if (!gapA) throw new Error('seed produced no gaps');
    await plansRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      { gapId: gapA.id, action: 'Editable-status action.', priority: 'high' },
    ]);
    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    const item = stored?.items[0];
    if (!item) throw new Error('plan item missing after persist');

    const updated = await plansRepo.updatePlanItem(user.id, item.item.id, 'complete', 'low');
    expect(updated?.item.status).toBe('complete');
    expect(updated?.item.priority).toBe('low');
    expect(updated?.item.action).toBe('Editable-status action.');
    expect(updated?.item.position).toBe(0);
    expect(updated?.requirementText).toBe('Kubernetes cluster operations');

    // Missing and foreign-owned are one outcome.
    expect(
      await plansRepo.updatePlanItem(
        user.id,
        '99999999-9999-4999-8999-999999999999',
        'complete',
        'low',
      ),
    ).toBeUndefined();
    const { user: stranger } = await seedReportWithGaps();
    expect(
      await plansRepo.updatePlanItem(stranger.id, item.item.id, 'complete', 'low'),
    ).toBeUndefined();
  });
});

describe('report-family cascade (delta 9 both-route sanity)', () => {
  it('findReportById is user-scoped; evidence read returns the report sub-score links', async () => {
    const { user, report } = await seedReportWithGaps();
    expect((await plansRepo.findReportById(user.id, report.id))?.id).toBe(report.id);
    const { user: stranger } = await seedReportWithGaps();
    expect(await plansRepo.findReportById(stranger.id, report.id)).toBeUndefined();
    // Seed report carries no evidence links — empty, not an error.
    expect(await plansRepo.findEvidenceForReport(user.id, report.id)).toEqual([]);
  });
});
