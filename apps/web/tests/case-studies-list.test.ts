// Case-studies list (M4-01 UI, M8-14): one row per draft (title link to its
// detail, draft/published status chip, provenance, updated date), the empty
// state, and the rendering law (M1-02) - titles are user/template-derived and
// escaped interpolation only, never markup. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseStudyListItem } from '@careerforge/core';

import CaseStudiesListPage from '../app/pages/case-studies/index.vue';

const { listCaseStudiesMock } = vi.hoisted(() => ({
  listCaseStudiesMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  listCaseStudies: listCaseStudiesMock,
}));

function study(overrides: Partial<CaseStudyListItem> = {}): CaseStudyListItem {
  return {
    id: 'fictional-cs-1',
    title: 'Building a fault-tolerant job queue',
    provenance: 'personal',
    status: 'draft',
    exerciseId: 'fictional-ex-1',
    exerciseTitle: 'Building a fault-tolerant job queue',
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('case studies list page', () => {
  beforeEach(() => {
    listCaseStudiesMock.mockReset();
    clearNuxtData();
  });

  it('renders one row per draft: title link to its detail, status chip, provenance', async () => {
    listCaseStudiesMock.mockResolvedValue({
      caseStudies: [
        study(),
        study({
          id: 'fictional-cs-2',
          title: 'A retro on the payments migration',
          provenance: 'personal_ai_assisted',
          status: 'published',
        }),
      ],
    });

    const wrapper = await mountSuspended(CaseStudiesListPage);
    const rows = wrapper.findAll('[data-testid="case-study-row"]');
    expect(rows).toHaveLength(2);

    const first = rows[0]!;
    const link = first.get('a');
    expect(link.text()).toBe('Building a fault-tolerant job queue');
    expect(link.attributes('href')).toBe('/case-studies/fictional-cs-1');
    expect(first.get('[data-testid="cs-status-chip"]').text()).toBe('draft');
    expect(first.get('[data-testid="cs-provenance"]').text()).toBe('personal');

    const second = rows[1]!;
    expect(second.get('[data-testid="cs-status-chip"]').text()).toBe('published');
    expect(second.get('[data-testid="cs-provenance"]').text()).toBe('personal_ai_assisted');
  });

  it('shows the empty state when there are no drafts', async () => {
    listCaseStudiesMock.mockResolvedValue({ caseStudies: [] });
    const wrapper = await mountSuspended(CaseStudiesListPage);
    expect(wrapper.find('[data-testid="case-studies-list"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('No case-study drafts yet');
  });

  it('a hostile draft title renders inert (interpolation, not markup)', async () => {
    listCaseStudiesMock.mockResolvedValue({
      caseStudies: [study({ title: '<img src=x onerror="document.body.dataset.xss=1">' })],
    });
    const wrapper = await mountSuspended(CaseStudiesListPage);
    const link = wrapper.get('[data-testid="case-study-row"] a');
    expect(link.element.querySelector('img')).toBeNull();
    expect(link.text()).toContain('<img');
  });

  it('surfaces a load error without throwing', async () => {
    listCaseStudiesMock.mockRejectedValue(new Error('network down'));
    const wrapper = await mountSuspended(CaseStudiesListPage);
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load case studies');
  });
});
