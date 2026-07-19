import { describe, expect, it } from 'vitest';

import {
  fitReportPlanResponseSchema,
  improvementPlanResponseSchema,
  PLAN_REVIEW_NOTES_MAX_CHARS,
  planDraftingRunSchema,
  planItemPatchBodySchema,
  planItemResponseSchema,
  planReviewBodySchema,
  type ImprovementPlanResponse,
  type PlanDraftingRun,
  type PlanItemResponse,
} from './plans.ts';

// All fixture data is fictional (RISKS P-01).

function runRow(overrides: Partial<PlanDraftingRun> = {}): PlanDraftingRun {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    promptId: 'improvement-plan@v1',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    status: 'ok',
    attempt: 1,
    inputTokens: 2100,
    outputTokens: 750,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 5200,
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

function itemRow(overrides: Partial<PlanItemResponse> = {}): PlanItemResponse {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    gapId: '66666666-6666-4666-8666-666666666666',
    action: 'Build and publish a small Kubernetes deployment walkthrough for a fictional service.',
    priority: 'high',
    status: 'planned',
    position: 0,
    gapClassification: 'genuine_gap',
    gapRequirementId: '33333333-3333-4333-8333-333333333333',
    requirementText: 'Kubernetes operations experience',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    ...overrides,
  };
}

function planRow(overrides: Partial<ImprovementPlanResponse> = {}): ImprovementPlanResponse {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    fitReportId: '22222222-2222-4222-8222-222222222222',
    reviewStatus: 'draft',
    notes: null,
    createdAt: '2026-01-02T03:04:06.000Z',
    items: [itemRow()],
    ...overrides,
  };
}

describe('planDraftingRunSchema', () => {
  it('accepts an ok run and every terminal status in the vocabulary', () => {
    expect(planDraftingRunSchema.parse(runRow())).toEqual(runRow());
    for (const status of ['schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'] as const) {
      expect(planDraftingRunSchema.safeParse(runRow({ status })).success).toBe(true);
    }
  });

  it('is strict and never carries rawResponse or userId', () => {
    expect(
      planDraftingRunSchema.safeParse({ ...runRow(), rawResponse: { any: 'thing' } }).success,
    ).toBe(false);
    expect(planDraftingRunSchema.safeParse({ ...runRow(), userId: 'u-1' }).success).toBe(false);
  });

  it('rejects an unknown status and a zero attempt', () => {
    expect(planDraftingRunSchema.safeParse(runRow({ status: 'partial' as never })).success).toBe(
      false,
    );
    expect(planDraftingRunSchema.safeParse(runRow({ attempt: 0 })).success).toBe(false);
  });
});

describe('planItemResponseSchema', () => {
  it('accepts a drafted item with its joined gap display fields', () => {
    expect(planItemResponseSchema.parse(itemRow())).toEqual(itemRow());
  });

  it('rejects vocabulary strays in priority and status', () => {
    expect(planItemResponseSchema.safeParse(itemRow({ priority: 'urgent' as never })).success).toBe(
      false,
    );
    // 'done' is NOT in the vocabulary — the family terminal is 'complete' (gate A1).
    expect(planItemResponseSchema.safeParse(itemRow({ status: 'done' as never })).success).toBe(
      false,
    );
    expect(planItemResponseSchema.safeParse(itemRow({ status: 'complete' })).success).toBe(true);
    expect(planItemResponseSchema.safeParse(itemRow({ status: 'dropped' })).success).toBe(true);
  });

  it('is strict — no extra keys ride along', () => {
    expect(planItemResponseSchema.safeParse({ ...itemRow(), score: 0.9 }).success).toBe(false);
  });
});

describe('fitReportPlanResponseSchema', () => {
  it('accepts the not-yet-drafted empty collection', () => {
    const empty = { run: null, plan: null, cached: false };
    expect(fitReportPlanResponseSchema.parse(empty)).toEqual(empty);
  });

  it('accepts a non-ok terminal draft (run present, plan null)', () => {
    const failed = {
      run: runRow({ status: 'schema_failed', attempt: 2 }),
      plan: null,
      cached: false,
    };
    expect(fitReportPlanResponseSchema.parse(failed)).toEqual(failed);
  });

  it('accepts a drafted plan and the cached re-serve', () => {
    const fresh = { run: runRow(), plan: planRow(), cached: false };
    expect(fitReportPlanResponseSchema.parse(fresh)).toEqual(fresh);
    const cached = { run: runRow(), plan: planRow(), cached: true };
    expect(fitReportPlanResponseSchema.parse(cached)).toEqual(cached);
  });

  it('items nest intact through the plan shape', () => {
    const plan = planRow({ items: [itemRow(), itemRow({ position: 1, priority: 'low' })] });
    expect(improvementPlanResponseSchema.parse(plan)).toEqual(plan);
  });
});

describe('planReviewBodySchema', () => {
  it('accepts absent, null, and real notes (nullish — a body-less POST arrives as null)', () => {
    expect(planReviewBodySchema.safeParse({}).success).toBe(true);
    expect(planReviewBodySchema.safeParse({ notes: null }).success).toBe(true);
    expect(
      planReviewBodySchema.safeParse({ notes: 'Looks right; drop the last item.' }).success,
    ).toBe(true);
  });

  it('rejects U+0000 and over-cap notes at the boundary (value-free 400, never a 500)', () => {
    expect(planReviewBodySchema.safeParse({ notes: 'a\u0000b' }).success).toBe(false);
    expect(
      planReviewBodySchema.safeParse({ notes: 'x'.repeat(PLAN_REVIEW_NOTES_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
  });
});

describe('planItemPatchBodySchema', () => {
  it('is full replacement: both mutable fields required, nothing else admitted', () => {
    expect(
      planItemPatchBodySchema.safeParse({ status: 'complete', priority: 'medium' }).success,
    ).toBe(true);
    expect(planItemPatchBodySchema.safeParse({ status: 'complete' }).success).toBe(false);
    expect(planItemPatchBodySchema.safeParse({ priority: 'medium' }).success).toBe(false);
    // The immutable fields cannot ride through the PATCH.
    expect(
      planItemPatchBodySchema.safeParse({
        status: 'complete',
        priority: 'medium',
        action: 'edited',
      }).success,
    ).toBe(false);
    expect(
      planItemPatchBodySchema.safeParse({
        status: 'complete',
        priority: 'medium',
        gapId: '66666666-6666-4666-8666-666666666666',
      }).success,
    ).toBe(false);
  });
});
