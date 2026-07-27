// Command Center homepage tests (M8-09). The dashboard is composed from three
// existing list endpoints; this pins that composition (pipeline tallies,
// posting-status tallies, criteria signal, recent activity, empty states).
// All data fictional. Mocks carry only the fields the page reads.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CommandCenterPage from '../app/pages/index.vue';

const { listPostingsMock, listApplicationsMock, getCriteriaSuggestionsMock } = vi.hoisted(() => ({
  listPostingsMock: vi.fn(),
  listApplicationsMock: vi.fn(),
  getCriteriaSuggestionsMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  listPostings: listPostingsMock,
  listApplications: listApplicationsMock,
  getCriteriaSuggestions: getCriteriaSuggestionsMock,
}));

// Whitespace-collapsed page text, so chip labels split across template lines
// (`{{ stage }} {{ count }}`) assert as "applied 1".
function flat(wrapper: { text: () => string }): string {
  return wrapper.text().replace(/\s+/g, ' ');
}

describe('command center page', () => {
  beforeEach(() => {
    listPostingsMock.mockReset();
    listApplicationsMock.mockReset();
    getCriteriaSuggestionsMock.mockReset();
    clearNuxtData();
  });

  it('renders pipeline, posting, criteria, and activity composed from existing endpoints', async () => {
    listPostingsMock.mockResolvedValue({
      postings: [
        {
          id: 'p1',
          company: 'Fictional Widgets Inc.',
          title: 'Senior Engineer',
          status: 'scored',
          createdAt: '2026-07-15T12:00:00.000Z',
        },
      ],
    });
    listApplicationsMock.mockResolvedValue({
      applications: [
        {
          id: 'a1',
          stage: 'applied',
          appliedOn: '2026-07-16',
          createdAt: '2026-07-16T09:00:00.000Z',
          posting: { company: 'Fictional Widgets Inc.', title: 'Senior Engineer' },
        },
        {
          id: 'a2',
          stage: 'interview',
          appliedOn: null,
          createdAt: '2026-07-10T09:00:00.000Z',
          posting: { company: 'Imaginary Corp', title: 'Staff Engineer' },
        },
      ],
    });
    getCriteriaSuggestionsMock.mockResolvedValue({
      status: 'ok',
      criteriaUpdatedAt: '2026-07-01T00:00:00.000Z',
      totals: {},
      thresholds: {},
      suggestions: [{ id: 's1' }],
    });

    const wrapper = await mountSuspended(CommandCenterPage);
    expect(wrapper.get('h1').text()).toBe('Command Center');

    // Quick actions link to the existing routes.
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'));
    expect(hrefs).toContain('/postings/new');
    expect(hrefs).toContain('/applications');
    expect(hrefs).toContain('/criteria');

    const text = flat(wrapper);
    // Pipeline: one chip per non-empty active stage, with its count.
    expect(text).toContain('applied 1');
    expect(text).toContain('interview 1');
    // Postings: tally by status.
    expect(text).toContain('scored 1');
    // Needs attention: the criteria suggestion count + singular wording.
    expect(text).toContain('1 criteria tuning suggestion ');
    // Recent activity merges both dated streams.
    expect(text).toContain('Pasted posting');
    expect(text).toContain('Tracked application');
    expect(text).toContain('Imaginary Corp');
  });

  it('shows empty states across every panel when there is no data', async () => {
    listPostingsMock.mockResolvedValue({ postings: [] });
    listApplicationsMock.mockResolvedValue({ applications: [] });
    getCriteriaSuggestionsMock.mockResolvedValue({
      status: 'insufficient_data',
      criteriaUpdatedAt: null,
      totals: {},
      thresholds: {},
      suggestions: [],
    });

    const wrapper = await mountSuspended(CommandCenterPage);
    const text = flat(wrapper);
    expect(text).toContain('No active applications');
    expect(text).toContain('No postings yet');
    expect(text).toContain('Nothing waiting on you');
    expect(text).toContain('No activity yet');
  });

  it('counts insufficient_data criteria as zero suggestions (no near-miss surface)', async () => {
    listPostingsMock.mockResolvedValue({ postings: [] });
    listApplicationsMock.mockResolvedValue({ applications: [] });
    // Even if a stale suggestions array rides along, insufficient_data => 0.
    getCriteriaSuggestionsMock.mockResolvedValue({
      status: 'insufficient_data',
      criteriaUpdatedAt: null,
      totals: {},
      thresholds: {},
      suggestions: [{ id: 'stale' }],
    });

    const wrapper = await mountSuspended(CommandCenterPage);
    expect(flat(wrapper)).toContain('Nothing waiting on you');
  });
});
