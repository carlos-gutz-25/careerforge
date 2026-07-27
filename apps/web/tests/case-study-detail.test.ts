// Case-study draft detail (M4-01 UI, M8-14): the draft render, the manage
// actions (refresh / publish / export / delete), the draft-vs-published action
// gating, the 404 state, and the RENDERING LAW (M1-02) - title and the
// renderedMarkdown body are user/template-derived and rendered as escaped text
// (interpolation / <pre>), NEVER parsed as markup. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseStudy } from '@careerforge/core';

import CaseStudyDetailPage from '../app/pages/case-studies/[id].vue';
import { ApiError } from '../app/utils/api-error.ts';

const {
  getCaseStudyMock,
  createCaseStudyMock,
  publishCaseStudyMock,
  deleteCaseStudyMock,
  exportCaseStudyMock,
  navigateToMock,
  routeState,
} = vi.hoisted(() => ({
  getCaseStudyMock: vi.fn(),
  createCaseStudyMock: vi.fn(),
  publishCaseStudyMock: vi.fn(),
  deleteCaseStudyMock: vi.fn(),
  exportCaseStudyMock: vi.fn(),
  navigateToMock: vi.fn(),
  routeState: { params: { id: 'fictional-cs-id' } as Record<string, string> },
}));

mockNuxtImport('useApi', () => () => ({
  getCaseStudy: getCaseStudyMock,
  createCaseStudy: createCaseStudyMock,
  publishCaseStudy: publishCaseStudyMock,
  deleteCaseStudy: deleteCaseStudyMock,
  exportCaseStudy: exportCaseStudyMock,
}));
mockNuxtImport('useRoute', () => () => ({
  path: '/case-studies/fictional-cs-id',
  fullPath: '/case-studies/fictional-cs-id',
  params: routeState.params,
  query: {},
}));
mockNuxtImport('navigateTo', () => navigateToMock);

function study(overrides: Partial<CaseStudy> = {}): CaseStudy {
  return {
    id: 'fictional-cs-id',
    title: 'Building a fault-tolerant job queue',
    provenance: 'personal',
    status: 'draft',
    exerciseId: 'fictional-ex-1',
    exerciseTitle: 'Building a fault-tolerant job queue',
    renderedMarkdown: '# Building a fault-tolerant job queue\n\n## Context\n\nA sample write-up.',
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('case study detail page', () => {
  beforeEach(() => {
    getCaseStudyMock.mockReset();
    createCaseStudyMock.mockReset();
    publishCaseStudyMock.mockReset();
    deleteCaseStudyMock.mockReset();
    exportCaseStudyMock.mockReset();
    navigateToMock.mockReset();
    routeState.params = { id: 'fictional-cs-id' };
    clearNuxtData();
  });

  it('renders the draft: title, status chip, provenance, source exercise, and the markdown body', async () => {
    getCaseStudyMock.mockResolvedValue(study());
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    expect(wrapper.get('h1').text()).toBe('Building a fault-tolerant job queue');
    expect(wrapper.get('[data-testid="cs-status-chip"]').text()).toBe('draft');
    expect(wrapper.get('[data-testid="cs-provenance"]').text()).toBe('personal');
    expect(wrapper.get('[data-testid="cs-meta"]').text()).toContain(
      'from exercise: Building a fault-tolerant job queue',
    );
    expect(wrapper.get('[data-testid="cs-markdown"]').text()).toContain('## Context');
  });

  it('renders a hostile title AND hostile markdown inert (interpolation / <pre>, not markup)', async () => {
    getCaseStudyMock.mockResolvedValue(
      study({
        title: '<img src=x onerror="document.body.dataset.xss=1">',
        renderedMarkdown: '<script>document.body.dataset.md = "1"</script>\n<img src=y onerror=1>',
      }),
    );
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    // Title: escaped text, no parsed element.
    expect(wrapper.get('h1').element.querySelector('img')).toBeNull();
    expect(wrapper.get('h1').text()).toContain('<img');
    // Markdown body: rendered in a <pre> as escaped text, never parsed markup.
    const pre = wrapper.get('[data-testid="cs-markdown"]');
    expect(pre.element.tagName).toBe('PRE');
    expect(pre.element.querySelector('img')).toBeNull();
    expect(pre.element.querySelector('script')).toBeNull();
    expect(pre.text()).toContain('<script>');
    expect(pre.text()).toContain('<img src=y');
  });

  it('a draft shows refresh / publish / export / delete', async () => {
    getCaseStudyMock.mockResolvedValue(study());
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    expect(wrapper.find('[data-testid="cs-refresh"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cs-publish"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cs-export"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cs-delete"]').exists()).toBe(true);
  });

  it('refresh re-POSTs the exercise + provenance + current title, then refetches', async () => {
    getCaseStudyMock.mockResolvedValue(study());
    createCaseStudyMock.mockResolvedValue(study());
    const wrapper = await mountSuspended(CaseStudyDetailPage);

    await wrapper.get('[data-testid="cs-refresh"]').trigger('click');
    await vi.waitFor(() =>
      expect(createCaseStudyMock).toHaveBeenCalledWith({
        exerciseId: 'fictional-ex-1',
        provenance: 'personal',
        title: 'Building a fault-tolerant job queue',
      }),
    );
    // The refresh re-reads the draft (2 GETs: initial + refresh).
    await vi.waitFor(() => expect(getCaseStudyMock).toHaveBeenCalledTimes(2));
  });

  it('publish flips the draft to published; the published draft hides refresh/publish but keeps export/delete', async () => {
    getCaseStudyMock
      .mockResolvedValueOnce(study())
      .mockResolvedValueOnce(study({ status: 'published' }));
    publishCaseStudyMock.mockResolvedValue(study({ status: 'published' }));

    const wrapper = await mountSuspended(CaseStudyDetailPage);
    await wrapper.get('[data-testid="cs-publish"]').trigger('click');
    await vi.waitFor(() => expect(publishCaseStudyMock).toHaveBeenCalledWith('fictional-cs-id'));
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="cs-status-chip"]').text()).toBe('published'),
    );
    expect(wrapper.find('[data-testid="cs-refresh"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="cs-publish"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="cs-export"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cs-delete"]').exists()).toBe(true);
  });

  it('export downloads via the export helper', async () => {
    getCaseStudyMock.mockResolvedValue(study());
    exportCaseStudyMock.mockResolvedValue(undefined);
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    await wrapper.get('[data-testid="cs-export"]').trigger('click');
    await vi.waitFor(() => expect(exportCaseStudyMock).toHaveBeenCalledWith('fictional-cs-id'));
  });

  it('delete removes the draft and returns to the list', async () => {
    getCaseStudyMock.mockResolvedValue(study());
    deleteCaseStudyMock.mockResolvedValue(null);
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    await wrapper.get('[data-testid="cs-delete"]').trigger('click');
    await vi.waitFor(() => expect(deleteCaseStudyMock).toHaveBeenCalledWith('fictional-cs-id'));
    await vi.waitFor(() => expect(navigateToMock).toHaveBeenCalledWith('/case-studies'));
  });

  it('hides refresh when the source exercise was deleted (exerciseId null)', async () => {
    getCaseStudyMock.mockResolvedValue(study({ exerciseId: null }));
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    expect(wrapper.find('[data-testid="cs-refresh"]').exists()).toBe(false);
    // Publish/export/delete stay available.
    expect(wrapper.find('[data-testid="cs-publish"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cs-export"]').exists()).toBe(true);
  });

  it('hides refresh when the provenance is not wire-creatable (professional)', async () => {
    getCaseStudyMock.mockResolvedValue(study({ provenance: 'professional' }));
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    expect(wrapper.find('[data-testid="cs-refresh"]').exists()).toBe(false);
  });

  it('shows a not-found state for a missing draft (404)', async () => {
    getCaseStudyMock.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'no such case study'));
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    expect(wrapper.get('[role="alert"]').text()).toContain('Case study not found');
  });

  it('a failed publish surfaces the error and keeps the draft', async () => {
    getCaseStudyMock.mockResolvedValue(study());
    publishCaseStudyMock.mockRejectedValue(
      new ApiError(409, 'ALREADY_PUBLISHED', 'this draft is already published'),
    );
    const wrapper = await mountSuspended(CaseStudyDetailPage);
    await wrapper.get('[data-testid="cs-publish"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="cs-action-error"]').text()).toContain('already published'),
    );
    // Still a draft - the failed action did not flip it.
    expect(wrapper.get('[data-testid="cs-status-chip"]').text()).toBe('draft');
  });
});
