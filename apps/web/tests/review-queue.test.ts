// Review queue page (M3-05 UI, M8-13). DUE revisits over completed exercises,
// soonest-due first by API contract. Exercise titles are user-authored and
// UNTRUSTED - rendered via {{ interpolation }} only. The one action, "Mark
// revisited", records the existing mastery-evidence kind 'revisited' and
// re-fetches, so the item advances past its interval and leaves the due list.
// All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewQueueItem } from '@careerforge/core';

import ReviewQueuePage from '../app/pages/review-queue/index.vue';
import { ApiError } from '../app/utils/api-error.ts';

const { getReviewQueueMock, createMasteryEvidenceMock } = vi.hoisted(() => ({
  getReviewQueueMock: vi.fn(),
  createMasteryEvidenceMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getReviewQueue: getReviewQueueMock,
  createMasteryEvidence: createMasteryEvidenceMock,
}));

function item(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    exerciseId: 'fictional-ex-1',
    title: 'Rebuild the token refresh flow from scratch',
    kind: 'project',
    learningPlanId: 'fictional-plan-9',
    completedOn: '2026-07-01',
    revisitCount: 1,
    intervalDays: 30,
    dueOn: '2026-07-27',
    ...overrides,
  };
}

describe('review queue page', () => {
  beforeEach(() => {
    getReviewQueueMock.mockReset();
    createMasteryEvidenceMock.mockReset();
    clearNuxtData();
  });

  it('renders one row per due item: title link to its plan, kind, due date, revisit number', async () => {
    getReviewQueueMock.mockResolvedValue({
      items: [
        item(),
        item({
          exerciseId: 'fictional-ex-2',
          title: 'Kata: implement an LRU cache',
          kind: 'kata',
          learningPlanId: 'fictional-plan-4',
          revisitCount: 0,
          intervalDays: 7,
          dueOn: '2026-07-25',
        }),
      ],
    });

    const wrapper = await mountSuspended(ReviewQueuePage);
    const rows = wrapper.findAll('[data-testid="review-queue-row"]');
    expect(rows).toHaveLength(2);

    const first = rows[0]!;
    const link = first.get('a');
    expect(link.text()).toBe('Rebuild the token refresh flow from scratch');
    // The title links to the parent learning plan, where revisits are recorded.
    expect(link.attributes('href')).toBe('/learning-plans/fictional-plan-9');
    expect(first.get('[data-testid="rq-kind"]').text()).toBe('project');
    expect(first.get('[data-testid="rq-due"]').text()).toContain('2026-07-27');
    // revisitCount 1 means the UPCOMING revisit is number 2.
    expect(first.text()).toContain('revisit 2');
    expect(first.text()).toContain('30-day interval');
  });

  it('shows the empty state when nothing is due', async () => {
    getReviewQueueMock.mockResolvedValue({ items: [] });
    const wrapper = await mountSuspended(ReviewQueuePage);
    expect(wrapper.find('[data-testid="review-queue-list"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Nothing is due for review');
  });

  it('a hostile exercise title renders inert (interpolation, not markup)', async () => {
    getReviewQueueMock.mockResolvedValue({
      items: [item({ title: '<img src=x onerror="document.body.dataset.xss=1">' })],
    });
    const wrapper = await mountSuspended(ReviewQueuePage);
    const link = wrapper.get('[data-testid="review-queue-row"] a');
    expect(link.element.querySelector('img')).toBeNull();
    expect(link.text()).toContain('<img');
  });

  it('Mark revisited records kind "revisited" for that exercise, then re-fetches (item leaves the list)', async () => {
    getReviewQueueMock
      .mockResolvedValueOnce({ items: [item()] })
      .mockResolvedValueOnce({ items: [] });
    createMasteryEvidenceMock.mockResolvedValue({
      id: 'fictional-ev-1',
      exerciseId: 'fictional-ex-1',
      kind: 'revisited',
      artifactUrl: null,
      recordedOn: '2026-07-27',
      createdAt: '2026-07-27T12:00:00.000Z',
    });

    const wrapper = await mountSuspended(ReviewQueuePage);
    expect(wrapper.findAll('[data-testid="review-queue-row"]')).toHaveLength(1);

    await wrapper.get('[data-testid="rq-mark-revisited"]').trigger('click');
    await vi.waitFor(() =>
      expect(createMasteryEvidenceMock).toHaveBeenCalledWith({
        exerciseId: 'fictional-ex-1',
        kind: 'revisited',
      }),
    );
    // The re-fetch returned an empty queue: the item advanced past its interval.
    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-testid="review-queue-row"]')).toHaveLength(0),
    );
    expect(wrapper.text()).toContain('Nothing is due for review');
  });

  it('a failed Mark revisited surfaces the error and does not drop the item', async () => {
    getReviewQueueMock.mockResolvedValue({ items: [item()] });
    createMasteryEvidenceMock.mockRejectedValue(
      new ApiError(500, 'INTERNAL', 'could not record the revisit right now'),
    );

    const wrapper = await mountSuspended(ReviewQueuePage);
    await wrapper.get('[data-testid="rq-mark-revisited"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="rq-action-error"]').text()).toContain(
        'could not record the revisit',
      ),
    );
    // The item is still present - a failed action must not silently drop it.
    expect(wrapper.findAll('[data-testid="review-queue-row"]')).toHaveLength(1);
  });
});
