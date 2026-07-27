// Evidence Library page tests (M8-09). The profile view relocated to /evidence
// and reframed as the fit-scoring evidence base. Renders GET /profile; all data
// fictional. Pins the rendering side (interpolation only, per the app law).
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EvidenceLibraryPage from '../app/pages/evidence.vue';

const { getProfileMock } = vi.hoisted(() => ({ getProfileMock: vi.fn() }));

mockNuxtImport('useApi', () => () => ({ getProfile: getProfileMock }));

describe('evidence library page', () => {
  beforeEach(() => {
    getProfileMock.mockReset();
    clearNuxtData();
  });

  it('renders skills, experience, and projects as the evidence base', async () => {
    getProfileMock.mockResolvedValue({
      skills: [
        {
          id: 'skill-1',
          name: 'TypeScript',
          category: 'language',
          level: 'expert',
          years: 6,
          lastUsed: '2026',
        },
      ],
      experiences: [
        {
          id: 'exp-1',
          title: 'Senior Engineer',
          company: 'Fictional Widgets Inc.',
          startDate: '2020',
          endDate: null,
        },
      ],
      projects: [
        {
          id: 'proj-1',
          name: 'Widget Sorter',
          provenance: 'professional',
          summary: 'Sorts widgets.',
        },
      ],
    });

    const wrapper = await mountSuspended(EvidenceLibraryPage);
    expect(wrapper.get('h1').text()).toBe('Evidence Library');

    const text = wrapper.text();
    expect(text).toContain('TypeScript');
    expect(text).toContain('expert');
    expect(text).toContain('Senior Engineer');
    expect(text).toContain('Fictional Widgets Inc.');
    expect(text).toContain('to present'); // open-ended period
    expect(text).toContain('Widget Sorter');
    expect(text).toContain('professional'); // provenance chip
    expect(text).toContain('Sorts widgets.');
  });

  it('shows per-section empty states when the profile is empty', async () => {
    getProfileMock.mockResolvedValue({ skills: [], experiences: [], projects: [] });

    const wrapper = await mountSuspended(EvidenceLibraryPage);
    const text = wrapper.text();
    expect(text).toContain('No skills imported yet');
    expect(text).toContain('No experience imported yet');
    expect(text).toContain('No projects imported yet');
    // No data tables render when there is nothing to show.
    expect(wrapper.find('table').exists()).toBe(false);
  });
});
