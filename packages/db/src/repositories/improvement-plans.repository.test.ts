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
  type PlanItemRecommendationInsert,
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
    evaluator: 'skill_evidence' as const,
    confidence: null,
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

// M7-01b: typed recommendations (plan_item_recommendations, migration 0020).
// Born unused until M7-03 — driven directly through the repository here. All
// fixture text fictional (RISKS P-01).
function recInsert(
  overrides: Partial<PlanItemRecommendationInsert> = {},
): PlanItemRecommendationInsert {
  return {
    kind: 'resource',
    title: 'Read the fictional k8s operators guide.',
    rationale: 'Closes the named cluster-operations gap with a focused resource.',
    expectedBenefit: 'Able to reason about reconciliation loops in interviews.',
    ...overrides,
  };
}

describe('plan_item_recommendations persist extension (M7-01b, D2a/D3)', () => {
  it('inserts recommendations in the SAME txn, per-item, born suggested by default', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');

    const outcome = await plansRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      [
        {
          gapId: gapA.id,
          action: 'Item with two recommendations.',
          priority: 'high',
          recommendations: [
            recInsert({ kind: 'resource', title: 'First rec.' }),
            recInsert({ kind: 'demo_project', title: 'Second rec.' }),
          ],
        },
        { gapId: gapB.id, action: 'Item with no recommendations.', priority: 'medium' },
      ],
    );
    expect(outcome.planCreated).toBe(true);

    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    if (!stored) throw new Error('plan missing after persist');
    const [item0, item1] = stored.items;
    if (!item0 || !item1) throw new Error('expected two items');

    const recs = await plansRepo.findRecommendationsForPlan(user.id, stored.plan.id);
    expect(recs).toHaveLength(2);
    // All belong to the first item, positions 0 and 1, born 'suggested'.
    expect(recs.every((r) => r.planItemId === item0.item.id)).toBe(true);
    expect(recs.map((r) => r.position)).toEqual([0, 1]);
    expect(recs.map((r) => r.status)).toEqual(['suggested', 'suggested']);
    expect(recs.map((r) => r.kind)).toEqual(['resource', 'demo_project']);
    expect(recs.map((r) => r.title)).toEqual(['First rec.', 'Second rec.']);
    expect(recs.every((r) => r.userId === user.id)).toBe(true);
    // The second item genuinely carries none.
    expect(recs.some((r) => r.planItemId === item1.item.id)).toBe(false);
  });

  it('citation-failed run writes NO recommendations (raw count 0 — flag-write-nothing)', async () => {
    const { user, report } = await seedReportWithGaps();
    // A failed citation means items === undefined; recommendations can never
    // be reached (they follow items). Prove it at the table level.
    const outcome = await plansRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      true,
      undefined,
    );
    expect(outcome.planCreated).toBe(false);
    const { rows } = await handle.pool.query<{ n: string }>(
      'select count(*) as n from plan_item_recommendations',
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('v1 path (no recommendations arg) is behaviourally unchanged — zero recommendation rows', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const gapA = gaps[0];
    if (!gapA) throw new Error('seed produced no gaps');
    await plansRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      { gapId: gapA.id, action: 'v1-style item, no recommendations.', priority: 'high' },
    ]);
    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    if (!stored) throw new Error('plan missing after persist');
    expect(stored.items).toHaveLength(1);
    expect(await plansRepo.findRecommendationsForPlan(user.id, stored.plan.id)).toEqual([]);
  });
});

describe('findRecommendationsForPlan (M7-01b read, D2b/D3)', () => {
  it('orders by (item position, rec position, id) and is user-scoped', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');

    await plansRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      {
        gapId: gapA.id,
        action: 'First item.',
        priority: 'high',
        recommendations: [recInsert({ title: 'item0-rec0' }), recInsert({ title: 'item0-rec1' })],
      },
      {
        gapId: gapB.id,
        action: 'Second item.',
        priority: 'medium',
        recommendations: [recInsert({ title: 'item1-rec0' })],
      },
    ]);
    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    if (!stored) throw new Error('plan missing after persist');

    const recs = await plansRepo.findRecommendationsForPlan(user.id, stored.plan.id);
    // Grouped by item order, then recommendation position within the item.
    expect(recs.map((r) => r.title)).toEqual(['item0-rec0', 'item0-rec1', 'item1-rec0']);

    // Cross-user read of the same plan id returns nothing (user-scoped).
    const { user: stranger } = await seedReportWithGaps();
    expect(await plansRepo.findRecommendationsForPlan(stranger.id, stored.plan.id)).toEqual([]);
  });
});

describe('updatePlanItemRecommendationStatus (M7-01b status CAS, D2c/D3)', () => {
  async function seedOneRecommendation() {
    const { user, report, gaps } = await seedReportWithGaps();
    const gapA = gaps[0];
    if (!gapA) throw new Error('seed produced no gaps');
    await plansRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      {
        gapId: gapA.id,
        action: 'Item with one recommendation.',
        priority: 'high',
        recommendations: [recInsert()],
      },
    ]);
    const stored = await plansRepo.findPlanForReport(user.id, report.id);
    if (!stored) throw new Error('plan missing after persist');
    const [rec] = await plansRepo.findRecommendationsForPlan(user.id, stored.plan.id);
    if (!rec) throw new Error('recommendation missing after persist');
    return { user, rec };
  }

  it('updates status only, leaves the drafted fields untouched, round-trips all three values', async () => {
    const { user, rec } = await seedOneRecommendation();
    expect(rec.status).toBe('suggested');

    const adopted = await plansRepo.updatePlanItemRecommendationStatus(user.id, rec.id, 'adopted');
    expect(adopted?.status).toBe('adopted');
    // Drafted fields are immutable — only status moved.
    expect(adopted?.kind).toBe(rec.kind);
    expect(adopted?.title).toBe(rec.title);
    expect(adopted?.rationale).toBe(rec.rationale);
    expect(adopted?.expectedBenefit).toBe(rec.expectedBenefit);
    expect(adopted?.position).toBe(rec.position);

    // Plain setter to any lifecycle value (no one-way rule baked here).
    expect(
      (await plansRepo.updatePlanItemRecommendationStatus(user.id, rec.id, 'dismissed'))?.status,
    ).toBe('dismissed');
    expect(
      (await plansRepo.updatePlanItemRecommendationStatus(user.id, rec.id, 'suggested'))?.status,
    ).toBe('suggested');
  });

  it('is user-scoped and 404s the unknown and the foreign', async () => {
    const { user, rec } = await seedOneRecommendation();
    expect(
      await plansRepo.updatePlanItemRecommendationStatus(
        user.id,
        '99999999-9999-4999-8999-999999999999',
        'adopted',
      ),
    ).toBeUndefined();
    const { user: stranger } = await seedReportWithGaps();
    expect(
      await plansRepo.updatePlanItemRecommendationStatus(stranger.id, rec.id, 'adopted'),
    ).toBeUndefined();
    // The foreign attempt left the row untouched (still born 'suggested').
    const { rows } = await handle.pool.query<{ status: string }>(
      'select status from plan_item_recommendations where id = $1',
      [rec.id],
    );
    expect(rows[0]?.status).toBe('suggested');
  });
});

describe('plan_item_recommendations cascade (M7-01b, D1)', () => {
  it('deleting the fit report removes the plan, items, and their recommendations', async () => {
    const { user, report, gaps } = await seedReportWithGaps();
    const gapA = gaps[0];
    if (!gapA) throw new Error('seed produced no gaps');
    await plansRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      {
        gapId: gapA.id,
        action: 'Item that will be cascade-deleted.',
        priority: 'high',
        recommendations: [recInsert(), recInsert({ kind: 'practice', title: 'Second rec.' })],
      },
    ]);
    const before = await handle.pool.query<{ n: string }>(
      'select count(*) as n from plan_item_recommendations',
    );
    expect(before.rows[0]?.n).toBe('2');

    // Delete the report — the plan → items → recommendations cascade spine.
    await handle.pool.query('delete from fit_reports where id = $1', [report.id]);

    const after = await handle.pool.query<{ n: string }>(
      'select count(*) as n from plan_item_recommendations',
    );
    expect(after.rows[0]?.n).toBe('0');
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
