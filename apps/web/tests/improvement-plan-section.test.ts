// Improvement plan UI (M1-12): report-scoped plan (pin-to-report), draft
// trigger gated on a REVIEWED report and fired once, loud flagged/failed-run
// banner, priority-grouped items with the A2 two-field editor, one-shot plan
// review, the plan-telemetry footer, and the rendering law (M1-02): every
// action/requirement/evidence/notes field renders as escaped interpolation
// only. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Runtime core import is fine HERE (vitest/node) — the types-only law binds
// the app bundle, and gap-section.test.ts pins it source-wide.
import {
  PLAN_ITEM_PRIORITIES,
  PLAN_ITEM_STATUSES,
  type FitReportPlanResponse,
  type FitReportResponse,
  type PlanDraftingRun,
  type PlanItemResponse,
} from '@careerforge/core';

import ImprovementPlanSection from '../app/components/ImprovementPlanSection.vue';

const {
  getFitReportPlanMock,
  draftImprovementPlanMock,
  reviewImprovementPlanMock,
  updatePlanItemMock,
} = vi.hoisted(() => ({
  getFitReportPlanMock: vi.fn(),
  draftImprovementPlanMock: vi.fn(),
  reviewImprovementPlanMock: vi.fn(),
  updatePlanItemMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getFitReportPlan: getFitReportPlanMock,
  draftImprovementPlan: draftImprovementPlanMock,
  reviewImprovementPlan: reviewImprovementPlanMock,
  updatePlanItem: updatePlanItemMock,
}));

function runFixture(overrides: Partial<PlanDraftingRun> = {}): PlanDraftingRun {
  return {
    id: 'fictional-run-1',
    promptId: 'improvement-plan@v1',
    provider: 'anthropic',
    model: 'mock-sonnet',
    status: 'ok',
    attempt: 1,
    inputTokens: 2100,
    outputTokens: 750,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 5200,
    createdAt: '2026-07-19T10:00:00.000Z',
    ...overrides,
  };
}

function itemFixture(overrides: Partial<PlanItemResponse> = {}): PlanItemResponse {
  return {
    id: 'fictional-item-1',
    gapId: 'fictional-gap-1',
    action: 'Publish a fictional Kubernetes lab writeup.',
    priority: 'high',
    status: 'planned',
    position: 0,
    gapClassification: 'genuine_gap',
    gapRequirementId: 'fictional-requirement-1',
    requirementText: 'Kubernetes cluster operations',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    ...overrides,
  };
}

function planResponse(
  items: PlanItemResponse[],
  overrides: { reviewStatus?: 'draft' | 'reviewed'; notes?: string | null } = {},
): FitReportPlanResponse {
  return {
    run: runFixture(),
    plan: {
      id: 'fictional-plan-1',
      fitReportId: 'fictional-report-1',
      reviewStatus: overrides.reviewStatus ?? 'draft',
      notes: overrides.notes ?? null,
      createdAt: '2026-07-19T10:00:01.000Z',
      items,
    },
    cached: false,
  };
}

function reportFixture(reviewStatus: 'draft' | 'reviewed' = 'reviewed'): FitReportResponse {
  return {
    id: 'fictional-report-1',
    postingId: 'fictional-posting-1',
    extractionRunId: 'fictional-extraction-run-1',
    reviewStatus,
    notes: null,
    createdAt: '2026-07-19T09:00:00.000Z',
    report: {
      verdict: 'scored',
      exclusions: [],
      subScores: [
        {
          dimension: 'technical',
          score: 0.4,
          rationale: 'fictional technical rationale',
          evidence: [
            {
              requirementId: 'fictional-requirement-1',
              profileSkillId: null,
              profileProjectId: null,
              profileExperienceId: null,
              postingQuote: 'must run production Kubernetes',
              profileQuote: 'operated a fictional staging cluster',
              strength: 'partial',
            },
          ],
        },
      ],
      unscoredRequirements: [],
      forcedLowestPriority: { applied: false, matchedSlugs: [] },
      inputFlagged: false,
    },
  };
}

// Each mount gets a UNIQUE report id (the useAsyncData payload-cache lesson
// from gap-section.test.ts) — passed via reportId; the report prop keeps the
// fixture id fields internally consistent enough for rendering.
let mountSequence = 0;
async function mountSection(report: FitReportResponse = reportFixture()) {
  mountSequence += 1;
  return mountSuspended(ImprovementPlanSection, {
    props: { reportId: `fictional-report-${mountSequence}`, report },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImprovementPlanSection', () => {
  it('gates drafting on a reviewed report (no button on a draft report)', async () => {
    getFitReportPlanMock.mockResolvedValue({ run: null, plan: null, cached: false });
    const wrapper = await mountSection(reportFixture('draft'));
    expect(wrapper.find('[data-testid="plan-review-gate"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="plan-draft-button"]').exists()).toBe(false);
  });

  it('drafts once from a reviewed report and refetches', async () => {
    getFitReportPlanMock.mockResolvedValue({ run: null, plan: null, cached: false });
    draftImprovementPlanMock.mockResolvedValue(planResponse([itemFixture()]));
    const wrapper = await mountSection();

    const button = wrapper.find('[data-testid="plan-draft-button"]');
    expect(button.exists()).toBe(true);
    await button.trigger('click');
    await wrapper.vm.$nextTick();

    expect(draftImprovementPlanMock).toHaveBeenCalledTimes(1);
    expect(getFitReportPlanMock).toHaveBeenCalledTimes(2);
  });

  it('renders items grouped by priority with gap citations and evidence from the report payload', async () => {
    getFitReportPlanMock.mockResolvedValue(
      planResponse([
        itemFixture(),
        itemFixture({ id: 'fictional-item-2', priority: 'low', action: 'A low-priority action.' }),
      ]),
    );
    const wrapper = await mountSection();

    const groups = wrapper.findAll('[data-testid="plan-group"] h3');
    expect(groups.map((group) => group.text().replace(/\s+/g, ' ').trim())).toEqual([
      'High priority 1',
      'Low priority 1',
    ]);
    const firstItem = wrapper.find('[data-testid="plan-item"]');
    expect(firstItem.text()).toContain('Publish a fictional Kubernetes lab writeup.');
    expect(firstItem.find('[data-testid="plan-item-gap"]').text()).toContain(
      'Kubernetes cluster operations',
    );
    expect(firstItem.find('[data-testid="plan-item-gap"]').text()).toContain('genuine_gap');
    // Evidence rides from the ALREADY-FETCHED report payload, keyed by the
    // cited gap's requirement.
    const evidence = firstItem.find('[data-testid="plan-item-evidence"]');
    expect(evidence.exists()).toBe(true);
    expect(evidence.text()).toContain('must run production Kubernetes');
    expect(evidence.text()).toContain('operated a fictional staging cluster');
  });

  it('shows the loud role=alert banner for a flagged run with no plan', async () => {
    getFitReportPlanMock.mockResolvedValue({
      run: runFixture({ status: 'flagged' }),
      plan: null,
      cached: false,
    });
    const wrapper = await mountSection();
    const banner = wrapper.find('[data-testid="plan-failed-run"]');
    expect(banner.exists()).toBe(true);
    expect(banner.attributes('role')).toBe('alert');
    expect(banner.text()).toContain('flagged');
    expect(banner.text()).toContain('cited a gap that was never sent');
    // A failed run does not hide the draft button — re-POST is the retry.
    expect(wrapper.find('[data-testid="plan-draft-button"]').exists()).toBe(true);
  });

  it('updates an item with A2 full replacement (both fields sent) and refetches', async () => {
    getFitReportPlanMock.mockResolvedValue(planResponse([itemFixture()]));
    updatePlanItemMock.mockResolvedValue(itemFixture({ status: 'complete', priority: 'low' }));
    const wrapper = await mountSection();

    await wrapper.find('[data-testid="plan-item-edit-button"]').trigger('click');
    await wrapper.find('[data-testid="plan-status-select"]').setValue('complete');
    await wrapper.find('[data-testid="plan-priority-select"]').setValue('low');
    await wrapper.find('[data-testid="plan-item-save"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(updatePlanItemMock).toHaveBeenCalledWith('fictional-item-1', {
      status: 'complete',
      priority: 'low',
    });
    expect(getFitReportPlanMock).toHaveBeenCalledTimes(2);
  });

  it('offers exactly the core status and priority vocabularies (no drift)', async () => {
    getFitReportPlanMock.mockResolvedValue(planResponse([itemFixture()]));
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="plan-item-edit-button"]').trigger('click');

    const statusOptions = wrapper
      .findAll('[data-testid="plan-status-select"] option')
      .map((option) => option.attributes('value'));
    expect(new Set(statusOptions)).toEqual(new Set(PLAN_ITEM_STATUSES));
    expect(statusOptions).toHaveLength(PLAN_ITEM_STATUSES.length);

    const priorityOptions = wrapper
      .findAll('[data-testid="plan-priority-select"] option')
      .map((option) => option.attributes('value'));
    expect(new Set(priorityOptions)).toEqual(new Set(PLAN_ITEM_PRIORITIES));
    expect(priorityOptions).toHaveLength(PLAN_ITEM_PRIORITIES.length);
  });

  it('reviews the draft plan once with notes and refetches', async () => {
    getFitReportPlanMock.mockResolvedValue(planResponse([itemFixture()]));
    reviewImprovementPlanMock.mockResolvedValue({
      id: 'fictional-plan-1',
      reviewStatus: 'reviewed',
      notes: 'Looks right.',
    });
    const wrapper = await mountSection();

    expect(wrapper.find('[data-testid="plan-draft-chip"]').exists()).toBe(true);
    await wrapper.find('[data-testid="plan-review-notes"]').setValue('Looks right.');
    await wrapper.find('[data-testid="plan-mark-reviewed"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(reviewImprovementPlanMock).toHaveBeenCalledWith('fictional-plan-1', {
      notes: 'Looks right.',
    });
    expect(getFitReportPlanMock).toHaveBeenCalledTimes(2);
  });

  it('a reviewed plan shows the reviewed chip, notes, and no review form', async () => {
    getFitReportPlanMock.mockResolvedValue(
      planResponse([itemFixture()], { reviewStatus: 'reviewed', notes: 'Dropped one item.' }),
    );
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="plan-reviewed-chip"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="plan-notes"]').text()).toBe('Dropped one item.');
    expect(wrapper.find('[data-testid="plan-review-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="plan-draft-button"]').exists()).toBe(false);
  });

  it('renders the plan-telemetry footer from the drafting run', async () => {
    getFitReportPlanMock.mockResolvedValue(planResponse([itemFixture()]));
    const wrapper = await mountSection();
    const telemetry = wrapper.find('[data-testid="plan-telemetry"]');
    expect(telemetry.exists()).toBe(true);
    const text = telemetry.text().replace(/\s+/g, ' ');
    expect(text).toContain('improvement-plan@v1');
    expect(text).toContain('2100/750 tok');
    expect(text).toContain('5200 ms');
    expect(text).toContain('ok');
  });

  it('hostile LLM/posting-derived text stays inert on every rendered field', async () => {
    const hostile = '<script>window.__planPwned = true<' + '/script><img src=x onerror="x">';
    const report = reportFixture();
    const evidence = report.report.subScores[0]?.evidence[0];
    if (evidence) {
      evidence.postingQuote = hostile;
      evidence.profileQuote = hostile;
    }
    getFitReportPlanMock.mockResolvedValue(
      planResponse([itemFixture({ action: hostile, requirementText: hostile })], {
        notes: hostile,
      }),
    );
    const wrapper = await mountSection(report);
    expect(wrapper.find('[data-testid="plan-section"] script').exists()).toBe(false);
    expect(wrapper.find('[data-testid="plan-section"] img').exists()).toBe(false);
    expect((globalThis as Record<string, unknown>).__planPwned).toBeUndefined();
    expect(wrapper.find('[data-testid="plan-item"]').text()).toContain('<script>');
  });
});
