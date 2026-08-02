// Create-plan-from-gaps section (M3-01 UI, M8-12 slice 2): the affordance that
// selects a fit report's actionable gaps and drafts a FREE-CREATE learning
// plan over them. Covers the review-gate, eligible-gap filtering (only
// non-`have` rows are offered), default-all selection with toggle/select-all/
// clear, the fire-once paid draft (navigates on success, loud banner on a
// flagged 201-plan-null result), API error surfacing, and the rendering law
// (M1-02): posting-derived requirement text is escaped interpolation only. All
// data fictional. Mounts the component directly with props (the fit-report /
// interview-prep test pattern).
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FitReportGapsResponse,
  FitReportResponse,
  GapResponse,
  LearningPlanResponse,
  LearningPlanRun,
} from '@careerforge/core';

import CreateLearningPlanSection from '../app/components/CreateLearningPlanSection.vue';
import { ApiError } from '../app/utils/api-error.ts';
import { useDemoState } from '../app/composables/use-demo-mode.ts';

const { getFitReportGapsMock, createLearningPlanMock, navigateToMock } = vi.hoisted(() => ({
  getFitReportGapsMock: vi.fn(),
  createLearningPlanMock: vi.fn(),
  navigateToMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getFitReportGaps: getFitReportGapsMock,
  createLearningPlan: createLearningPlanMock,
}));
mockNuxtImport('navigateTo', () => navigateToMock);

// The component reads only `reviewStatus` off the report prop; a minimal object
// cast keeps the fixture from restating the whole fit shape.
function reportFixture(reviewStatus: 'draft' | 'reviewed'): FitReportResponse {
  return { id: 'fictional-report-id', reviewStatus } as unknown as FitReportResponse;
}

function gapFixture(overrides: Partial<GapResponse> = {}): GapResponse {
  return {
    id: 'fictional-gap-1',
    fitReportId: 'fictional-report-id',
    requirementId: 'fictional-requirement-1',
    classification: 'genuine_gap',
    engineClassification: 'genuine_gap',
    rationale: 'No evidence of this skill in the profile.',
    userOverridden: false,
    overrideNote: null,
    carriedVia: null,
    createdAt: '2026-07-24T12:00:00.000Z',
    requirementText: 'Kubernetes in production',
    requirementKind: 'must_have',
    requirementCategory: 'tool',
    ...overrides,
  };
}

function gapsResponse(gaps: GapResponse[]): FitReportGapsResponse {
  return { gaps, lostOverrides: 0 };
}

function runFixture(status: LearningPlanRun['status'] = 'flagged'): LearningPlanRun {
  return {
    id: 'fictional-run-id',
    promptId: 'learning-plan@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    status,
    attempt: 1,
    inputTokens: 1400,
    outputTokens: 600,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 8000,
    createdAt: '2026-07-24T12:00:00.000Z',
  };
}

function planResponse(planId: string): LearningPlanResponse {
  return {
    run: runFixture('ok'),
    cached: false,
    plan: { id: planId } as unknown as LearningPlanResponse['plan'],
  };
}

const TWO_ELIGIBLE = [
  gapFixture({ id: 'fictional-gap-1', requirementText: 'Kubernetes in production' }),
  gapFixture({
    id: 'fictional-gap-2',
    classification: 'needs_refresh',
    requirementText: 'GraphQL schema design',
  }),
];

const HOSTILE =
  '<script>document.body.dataset.xssExecuted = "fictional-marker"</script>' +
  '<img src=x onerror="document.body.dataset.xssExecuted = \'fictional-marker\'">';

describe('create-plan-from-gaps section (M8-12 slice 2)', () => {
  beforeEach(() => {
    getFitReportGapsMock.mockReset();
    createLearningPlanMock.mockReset();
    navigateToMock.mockReset();
    useDemoState().value = undefined;
    delete document.body.dataset.xssExecuted;
    clearNuxtData();
  });

  it('disables the draft trigger and shows the demo note in demo mode (M10-04)', async () => {
    useDemoState().value = true;
    getFitReportGapsMock.mockResolvedValue(gapsResponse(TWO_ELIGIBLE));
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    expect(wrapper.get('[data-testid="create-plan-submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="create-plan-demo-note"]').exists()).toBe(true);
  });

  it('review-gate: an unreviewed report shows the gate, not the checklist', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsResponse(TWO_ELIGIBLE));
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('draft') },
    });
    expect(wrapper.get('[data-testid="create-plan-review-gate"]').text()).toContain(
      'Review the fit report first',
    );
    expect(wrapper.find('[data-testid="create-plan-gaps"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="create-plan-submit"]').exists()).toBe(false);
  });

  it('offers only non-have gaps, all selected by default, with the count in the button', async () => {
    getFitReportGapsMock.mockResolvedValue(
      gapsResponse([
        ...TWO_ELIGIBLE,
        gapFixture({ id: 'fictional-gap-have', classification: 'have', requirementText: 'React' }),
      ]),
    );
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    const rows = wrapper.findAll('[data-testid="create-plan-gap"]');
    expect(rows).toHaveLength(2); // the `have` row is not offered
    const boxes = wrapper.findAll('[data-testid="create-plan-checkbox"]');
    expect(boxes.every((box) => (box.element as HTMLInputElement).checked)).toBe(true);
    expect(wrapper.get('[data-testid="create-plan-submit"]').text()).toContain(
      'Draft learning plan from 2 gaps',
    );
  });

  it('draft fires the POST once with the selected gap ids and navigates on success', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsResponse(TWO_ELIGIBLE));
    createLearningPlanMock.mockResolvedValue(planResponse('fictional-new-plan'));
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    await wrapper.get('[data-testid="create-plan-submit"]').trigger('click');
    await vi.waitFor(() => expect(createLearningPlanMock).toHaveBeenCalledTimes(1));
    expect(createLearningPlanMock).toHaveBeenCalledWith({
      gapIds: ['fictional-gap-1', 'fictional-gap-2'],
    });
    await vi.waitFor(() =>
      expect(navigateToMock).toHaveBeenCalledWith('/learning-plans/fictional-new-plan'),
    );
  });

  it('deselecting a gap drops it from the POST; clear disables the button', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsResponse(TWO_ELIGIBLE));
    createLearningPlanMock.mockResolvedValue(planResponse('fictional-new-plan'));
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    // Untick the first gap, then draft: only the second id rides the wire.
    await wrapper.findAll('[data-testid="create-plan-checkbox"]')[0]!.trigger('change');
    expect(wrapper.get('[data-testid="create-plan-submit"]').text()).toContain('from 1 gap');
    await wrapper.get('[data-testid="create-plan-submit"]').trigger('click');
    await vi.waitFor(() =>
      expect(createLearningPlanMock).toHaveBeenCalledWith({ gapIds: ['fictional-gap-2'] }),
    );
    // Clear empties the selection and disables the trigger (nothing to draft).
    await wrapper.get('[data-testid="create-plan-clear"]').trigger('click');
    expect(
      (wrapper.get('[data-testid="create-plan-submit"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('a flagged 201 (plan null) renders the loud banner and does not navigate', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsResponse(TWO_ELIGIBLE));
    createLearningPlanMock.mockResolvedValue({
      run: runFixture('flagged'),
      plan: null,
      cached: false,
    } satisfies LearningPlanResponse);
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    await wrapper.get('[data-testid="create-plan-submit"]').trigger('click');
    const banner = await vi.waitFor(() => wrapper.get('[data-testid="create-plan-flagged"]'));
    expect(banner.attributes('role')).toBe('alert');
    expect(banner.text()).toContain('flagged');
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('surfaces the API draft error (409 no-actionable-gaps) as received', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsResponse(TWO_ELIGIBLE));
    createLearningPlanMock.mockRejectedValue(
      new ApiError(409, 'NO_ACTIONABLE_GAPS', 'the selection has no actionable gaps'),
    );
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    await wrapper.get('[data-testid="create-plan-submit"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="create-plan-error"]').text()).toContain(
        'no actionable gaps',
      ),
    );
  });

  it('empty state when every requirement is already covered (no eligible gaps)', async () => {
    getFitReportGapsMock.mockResolvedValue(
      gapsResponse([gapFixture({ id: 'fictional-gap-have', classification: 'have' })]),
    );
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    expect(wrapper.get('[data-testid="create-plan-empty"]').text()).toContain(
      'every requirement is already covered',
    );
    expect(wrapper.find('[data-testid="create-plan-submit"]').exists()).toBe(false);
  });

  it('hostile requirement text renders INERT (same law as rawText)', async () => {
    getFitReportGapsMock.mockResolvedValue(
      gapsResponse([gapFixture({ requirementText: HOSTILE })]),
    );
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    const row = wrapper.get('[data-testid="create-plan-gap"]');
    expect(row.element.textContent).toContain(HOSTILE);
    expect(document.body.dataset.xssExecuted).toBeUndefined();
  });

  it('no section when the gaps fetch fails (degrade, never block the page)', async () => {
    getFitReportGapsMock.mockRejectedValue(new Error('api down'));
    const wrapper = await mountSuspended(CreateLearningPlanSection, {
      props: { reportId: 'fictional-report-id', report: reportFixture('reviewed') },
    });
    expect(wrapper.find('[data-testid="create-plan-section"]').exists()).toBe(false);
  });
});
