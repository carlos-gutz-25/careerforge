// Application list component tests (M1-03): rows render posting summaries
// via interpolation, and the stage filter drives the SERVER query (?stage=),
// not client-side filtering. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationWithPosting } from '@careerforge/core';

import ApplicationsListPage from '../app/pages/applications/index.vue';

const { listApplicationsMock } = vi.hoisted(() => ({
  listApplicationsMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({ listApplications: listApplicationsMock }));

function applicationFixture(
  overrides: Partial<ApplicationWithPosting> = {},
): ApplicationWithPosting {
  return {
    id: 'fictional-application-id',
    postingId: 'fictional-posting-id',
    stage: 'considering',
    appliedOn: null,
    createdAt: '2026-07-15T12:00:00.000Z',
    posting: { company: 'Fictional Widgets Inc.', title: 'Senior Software Engineer' },
    ...overrides,
  };
}

describe('applications list page', () => {
  beforeEach(() => {
    listApplicationsMock.mockReset();
    // useAsyncData caches by key across mounts in the shared nuxt test app.
    clearNuxtData();
  });

  it('renders application rows with posting summary, stage, and dates via interpolation', async () => {
    listApplicationsMock.mockResolvedValue({
      applications: [applicationFixture({ stage: 'applied', appliedOn: '2026-07-03' })],
    });

    const wrapper = await mountSuspended(ApplicationsListPage);

    expect(listApplicationsMock).toHaveBeenCalledWith(undefined);
    const row = wrapper.get('tbody tr');
    expect(row.text()).toContain('Fictional Widgets Inc.');
    expect(row.text()).toContain('Senior Software Engineer');
    expect(row.text()).toContain('applied');
    expect(row.text()).toContain('2026-07-03');
    expect(row.get('a').attributes('href')).toBe('/applications/fictional-application-id');
  });

  it('shows the empty state with a pointer to postings (create lives on the posting detail page)', async () => {
    listApplicationsMock.mockResolvedValue({ applications: [] });

    const wrapper = await mountSuspended(ApplicationsListPage);

    expect(wrapper.text()).toContain('No applications yet');
    expect(wrapper.find('table').exists()).toBe(false);
  });

  it('the stage filter refetches from the SERVER with the stage query (AC: filterable by stage)', async () => {
    listApplicationsMock.mockResolvedValue({ applications: [applicationFixture()] });

    const wrapper = await mountSuspended(ApplicationsListPage);
    listApplicationsMock.mockResolvedValue({
      applications: [applicationFixture({ id: 'applied-app-id', stage: 'applied' })],
    });
    await wrapper.get('select[name="stage"]').setValue('applied');
    await vi.waitFor(() => expect(listApplicationsMock).toHaveBeenCalledWith({ stage: 'applied' }));
    await new Promise((settle) => setTimeout(settle, 0));

    expect(wrapper.get('tbody tr').text()).toContain('applied');
  });

  it('a filtered empty result names the stage, not the global empty state', async () => {
    listApplicationsMock.mockResolvedValue({ applications: [applicationFixture()] });

    const wrapper = await mountSuspended(ApplicationsListPage);
    listApplicationsMock.mockResolvedValue({ applications: [] });
    await wrapper.get('select[name="stage"]').setValue('offer');
    await vi.waitFor(() => expect(listApplicationsMock).toHaveBeenCalledWith({ stage: 'offer' }));
    await new Promise((settle) => setTimeout(settle, 0));

    expect(wrapper.text()).toContain('No applications in stage');
    expect(wrapper.text()).not.toContain('No applications yet');
  });
});
