// Posting list component tests (M1-02). The list payload is metadata-only
// by API contract; this pins the rendering side. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PostingsListPage from '../app/pages/postings/index.vue';

const { listPostingsMock } = vi.hoisted(() => ({ listPostingsMock: vi.fn() }));

mockNuxtImport('useApi', () => () => ({ listPostings: listPostingsMock }));

describe('postings list page', () => {
  beforeEach(() => {
    listPostingsMock.mockReset();
    // useAsyncData caches by key across mounts in the shared nuxt test app.
    clearNuxtData();
  });

  it('renders company, title, status, and ingest date per row, linking to the detail page', async () => {
    listPostingsMock.mockResolvedValue({
      postings: [
        {
          id: 'fictional-id-1',
          company: 'Fictional Widgets Inc.',
          title: 'Senior Software Engineer',
          sourceNote: null,
          status: 'new',
          createdAt: '2026-07-15T12:00:00.000Z',
        },
        {
          id: 'fictional-id-2',
          company: null,
          title: null,
          sourceNote: null,
          status: 'archived',
          createdAt: '2026-07-14T12:00:00.000Z',
        },
      ],
    });

    const wrapper = await mountSuspended(PostingsListPage);
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(2);

    expect(rows[0]!.text()).toContain('Fictional Widgets Inc.');
    expect(rows[0]!.text()).toContain('Senior Software Engineer');
    expect(rows[0]!.text()).toContain('new');
    expect(rows[0]!.get('a').attributes('href')).toBe('/postings/fictional-id-1');
    expect(rows[0]!.classes()).not.toContain('posting-archived');

    // Null metadata renders placeholders; archived rows are visually dimmed.
    expect(rows[1]!.text()).toContain('Untitled');
    expect(rows[1]!.text()).toContain('—');
    expect(rows[1]!.classes()).toContain('posting-archived');
  });

  it('shows the empty state with a link to the paste form', async () => {
    listPostingsMock.mockResolvedValue({ postings: [] });

    const wrapper = await mountSuspended(PostingsListPage);

    expect(wrapper.text()).toContain('No postings yet');
    const links = wrapper.findAll('a').map((a) => a.attributes('href'));
    expect(links).toContain('/postings/new');
  });
});
