// Learning plans list (M3-01 UI, M8-12). Meta-only summaries, newest first,
// plural by design. Titles are LLM-derived and UNTRUSTED - rendered via
// {{ interpolation }} only. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LearningPlansListPage from '../app/pages/learning-plans/index.vue';

const { listLearningPlansMock } = vi.hoisted(() => ({ listLearningPlansMock: vi.fn() }));

mockNuxtImport('useApi', () => () => ({ listLearningPlans: listLearningPlansMock }));

describe('learning plans list page', () => {
  beforeEach(() => {
    listLearningPlansMock.mockReset();
    clearNuxtData();
  });

  it('renders one row per plan: title link, review chip, and gap count', async () => {
    listLearningPlansMock.mockResolvedValue({
      plans: [
        {
          id: 'fictional-plan-1',
          title: 'Close the Kubernetes gap',
          reviewStatus: 'draft',
          gapCount: 3,
          createdAt: '2026-07-20T12:00:00.000Z',
        },
        {
          id: 'fictional-plan-2',
          title: 'Deepen TypeScript',
          reviewStatus: 'reviewed',
          gapCount: 1,
          createdAt: '2026-07-19T12:00:00.000Z',
        },
      ],
    });

    const wrapper = await mountSuspended(LearningPlansListPage);
    const rows = wrapper.findAll('[data-testid="learning-plan-row"]');
    expect(rows).toHaveLength(2);

    const first = rows[0]!;
    const link = first.get('a');
    expect(link.text()).toBe('Close the Kubernetes gap');
    expect(link.attributes('href')).toBe('/learning-plans/fictional-plan-1');
    expect(first.text()).toContain('draft');
    expect(first.text()).toContain('3 gaps');
    // Singular gap count is not pluralized.
    expect(rows[1]!.text()).toContain('1 gap');
    expect(rows[1]!.text()).not.toContain('1 gaps');
  });

  it('shows the empty state when there are no plans', async () => {
    listLearningPlansMock.mockResolvedValue({ plans: [] });
    const wrapper = await mountSuspended(LearningPlansListPage);
    expect(wrapper.find('[data-testid="learning-plans-list"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('No learning plans yet');
  });

  it('a hostile plan title renders inert (interpolation, not markup)', async () => {
    listLearningPlansMock.mockResolvedValue({
      plans: [
        {
          id: 'fictional-plan-1',
          title: '<img src=x onerror="document.body.dataset.xss=1">',
          reviewStatus: 'draft',
          gapCount: 0,
          createdAt: '2026-07-20T12:00:00.000Z',
        },
      ],
    });
    const wrapper = await mountSuspended(LearningPlansListPage);
    const link = wrapper.get('[data-testid="learning-plan-row"] a');
    expect(link.element.querySelector('img')).toBeNull();
    expect(link.text()).toContain('<img');
  });
});
