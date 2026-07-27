// Learning plan detail (M3-01 UI, M8-12): the plan render (cited gaps,
// exercises with evidence counts), the M3-02 exercise CRUD (add / change
// status / delete, slice 3), the one-shot review, the 404 state, and the
// rendering law (M1-02) - title / focus / notes / exercise titles are
// LLM/posting/user-derived and escaped interpolation only. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXERCISE_KINDS, EXERCISE_STATUSES, type LearningPlanResponse } from '@careerforge/core';

import LearningPlanDetailPage from '../app/pages/learning-plans/[id].vue';
import { ApiError } from '../app/utils/api-error.ts';

const {
  getLearningPlanMock,
  reviewLearningPlanMock,
  createExerciseMock,
  updateExerciseStatusMock,
  deleteExerciseMock,
  routeState,
} = vi.hoisted(() => ({
  getLearningPlanMock: vi.fn(),
  reviewLearningPlanMock: vi.fn(),
  createExerciseMock: vi.fn(),
  updateExerciseStatusMock: vi.fn(),
  deleteExerciseMock: vi.fn(),
  routeState: { params: { id: 'fictional-plan-id' } as Record<string, string> },
}));

mockNuxtImport('useApi', () => () => ({
  getLearningPlan: getLearningPlanMock,
  reviewLearningPlan: reviewLearningPlanMock,
  createExercise: createExerciseMock,
  updateExerciseStatus: updateExerciseStatusMock,
  deleteExercise: deleteExerciseMock,
}));
mockNuxtImport('useRoute', () => () => ({
  path: '/learning-plans/fictional-plan-id',
  fullPath: '/learning-plans/fictional-plan-id',
  params: routeState.params,
  query: {},
}));

function planResponse(overrides: Partial<LearningPlanResponse['plan']> = {}): LearningPlanResponse {
  return {
    cached: false,
    run: {
      id: 'fictional-run-id',
      promptId: 'learning-plan@v1',
      provider: 'mock',
      model: 'mock-sonnet',
      status: 'ok',
      attempt: 1,
      inputTokens: 1500,
      outputTokens: 700,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      latencyMs: 9000,
      createdAt: '2026-07-20T12:00:00.000Z',
    },
    plan: {
      id: 'fictional-plan-id',
      title: 'Close the Kubernetes gap',
      reviewStatus: 'draft',
      notes: null,
      createdAt: '2026-07-20T12:00:00.000Z',
      gaps: [
        {
          id: 'fictional-plangap-1',
          gapId: 'fictional-gap-1',
          focus: 'Stand up a small cluster and deploy a service.',
          priority: 'high',
          position: 0,
          gapClassification: 'stretch',
          gapRequirementId: 'fictional-requirement-1',
          requirementText: 'Kubernetes in production',
          requirementKind: 'nice_to_have',
          requirementCategory: 'tool',
        },
      ],
      exercises: [
        {
          id: 'fictional-exercise-1',
          learningPlanId: 'fictional-plan-id',
          title: 'Deploy a demo service to k8s',
          kind: 'project',
          status: 'in_progress',
          position: 0,
          gapIds: ['fictional-gap-1'],
          createdAt: '2026-07-20T12:00:00.000Z',
          evidence: [
            {
              id: 'fictional-evidence-1',
              exerciseId: 'fictional-exercise-1',
              kind: 'implemented',
              artifactUrl: null,
              recordedOn: '2026-07-21',
              createdAt: '2026-07-21T12:00:00.000Z',
            },
          ],
        },
      ],
      ...overrides,
    },
  };
}

describe('learning plan detail page', () => {
  beforeEach(() => {
    getLearningPlanMock.mockReset();
    reviewLearningPlanMock.mockReset();
    createExerciseMock.mockReset();
    updateExerciseStatusMock.mockReset();
    deleteExerciseMock.mockReset();
    routeState.params = { id: 'fictional-plan-id' };
    delete document.body.dataset.xss;
    clearNuxtData();
  });

  it('renders the plan title, its cited gaps, and exercises with evidence counts', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse());
    const wrapper = await mountSuspended(LearningPlanDetailPage);

    expect(wrapper.get('h1').text()).toBe('Close the Kubernetes gap');
    const gaps = wrapper.findAll('[data-testid="lp-gap"]');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.text()).toContain('Stand up a small cluster');
    expect(gaps[0]!.text()).toContain('stretch');
    expect(gaps[0]!.text()).toContain('Kubernetes in production');

    const exercises = wrapper.findAll('[data-testid="lp-exercise"]');
    expect(exercises).toHaveLength(1);
    expect(exercises[0]!.text()).toContain('Deploy a demo service to k8s');
    expect(exercises[0]!.get('[data-testid="lp-exercise-status"]').text()).toBe('in_progress');
    expect(exercises[0]!.text()).toContain('1 gap');
    expect(exercises[0]!.text()).toContain('1 evidence');
  });

  it('draft: the review form submits trimmed-or-null notes and refreshes', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse());
    reviewLearningPlanMock.mockResolvedValue({
      id: 'fictional-plan-id',
      reviewStatus: 'reviewed',
      notes: null,
    });
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    expect(wrapper.find('[data-testid="lp-review-form"]').exists()).toBe(true);
    await wrapper.get('[data-testid="lp-mark-reviewed"]').trigger('click');
    await vi.waitFor(() =>
      expect(reviewLearningPlanMock).toHaveBeenCalledWith('fictional-plan-id', { notes: null }),
    );
  });

  it('reviewed: no review form, the reviewed chip shows', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse({ reviewStatus: 'reviewed' }));
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    expect(wrapper.find('[data-testid="lp-review-form"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="lp-review-chip"]').text()).toContain('reviewed');
  });

  it('empty exercises show the empty state', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse({ exercises: [] }));
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    expect(wrapper.find('[data-testid="lp-exercises"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="lp-no-exercises"]').text()).toContain('No exercises yet');
  });

  it('shows the not-found state on a 404', async () => {
    getLearningPlanMock.mockRejectedValue(
      new ApiError(404, 'NOT_FOUND', 'learning plan not found'),
    );
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    expect(wrapper.get('[role="alert"]').text()).toContain('Learning plan not found');
  });

  it('hostile title, focus, and notes render INERT (interpolation, not markup)', async () => {
    const HOSTILE = '<img src=x onerror="document.body.dataset.xss=1">';
    getLearningPlanMock.mockResolvedValue(
      planResponse({
        title: HOSTILE,
        notes: HOSTILE,
        gaps: [
          {
            id: 'fictional-plangap-1',
            gapId: 'fictional-gap-1',
            focus: HOSTILE,
            priority: 'high',
            position: 0,
            gapClassification: 'stretch',
            gapRequirementId: 'fictional-requirement-1',
            requirementText: 'Kubernetes in production',
            requirementKind: 'nice_to_have',
            requirementCategory: 'tool',
          },
        ],
      }),
    );
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    expect(wrapper.get('h1').element.querySelector('img')).toBeNull();
    expect(wrapper.get('h1').text()).toContain('<img');
    const notes = wrapper.get('[data-testid="lp-notes"]');
    expect(notes.element.children.length).toBe(0);
    expect(notes.element.textContent).toBe(HOSTILE);
    expect(document.body.dataset.xss).toBeUndefined();
  });

  it('add-exercise: submits create with plan id, trimmed title, kind, and selected gap ids', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse());
    createExerciseMock.mockResolvedValue({
      id: 'fictional-exercise-2',
      learningPlanId: 'fictional-plan-id',
      title: 'Write a k8s runbook',
      kind: 'writeup',
      status: 'planned',
      position: 1,
      gapIds: ['fictional-gap-1'],
      createdAt: '2026-07-22T12:00:00.000Z',
    });
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    // Submit is disabled until a title AND at least one gap are chosen.
    const submit = wrapper.get('[data-testid="lp-add-exercise-submit"]');
    expect((submit.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.get('[data-testid="lp-new-title"]').setValue('  Write a k8s runbook  ');
    await wrapper.get('[data-testid="lp-new-kind"]').setValue('writeup');
    await wrapper.get('[data-testid="lp-new-gap-checkbox"]').setValue(true);
    expect((submit.element as HTMLButtonElement).disabled).toBe(false);
    await submit.trigger('click');
    await vi.waitFor(() =>
      expect(createExerciseMock).toHaveBeenCalledWith({
        learningPlanId: 'fictional-plan-id',
        title: 'Write a k8s runbook',
        kind: 'writeup',
        gapIds: ['fictional-gap-1'],
      }),
    );
  });

  it('status select PATCHes the chosen status for that exercise', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse());
    updateExerciseStatusMock.mockResolvedValue({
      id: 'fictional-exercise-1',
      learningPlanId: 'fictional-plan-id',
      title: 'Deploy a demo service to k8s',
      kind: 'project',
      status: 'complete',
      position: 0,
      gapIds: ['fictional-gap-1'],
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    await wrapper.get('[data-testid="lp-exercise-status-select"]').setValue('complete');
    await vi.waitFor(() =>
      expect(updateExerciseStatusMock).toHaveBeenCalledWith('fictional-exercise-1', {
        status: 'complete',
      }),
    );
  });

  it('a 409 on complete-without-evidence surfaces the message', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse());
    updateExerciseStatusMock.mockRejectedValue(
      new ApiError(409, 'EXERCISE_NOT_COMPLETABLE', 'record implemented and tested evidence first'),
    );
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    await wrapper.get('[data-testid="lp-exercise-status-select"]').setValue('complete');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="lp-exercise-error"]').text()).toContain(
        'implemented and tested evidence',
      ),
    );
  });

  it('delete removes the exercise via the API', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse());
    deleteExerciseMock.mockResolvedValue(null);
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    await wrapper.get('[data-testid="lp-exercise-delete"]').trigger('click');
    await vi.waitFor(() => expect(deleteExerciseMock).toHaveBeenCalledWith('fictional-exercise-1'));
  });

  it('kind and status option vocab is complete against core enums (no silent drift)', async () => {
    getLearningPlanMock.mockResolvedValue(planResponse());
    const wrapper = await mountSuspended(LearningPlanDetailPage);
    const kindOptions = wrapper
      .get('[data-testid="lp-new-kind"]')
      .findAll('option')
      .map((o) => o.element.value);
    expect(kindOptions).toEqual([...EXERCISE_KINDS]);
    const statusOptions = wrapper
      .get('[data-testid="lp-exercise-status-select"]')
      .findAll('option')
      .map((o) => o.element.value);
    expect(statusOptions).toEqual([...EXERCISE_STATUSES]);
  });
});
