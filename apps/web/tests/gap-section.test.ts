// Gap classification UI (M1-11): report-scoped gap set grouped in LADDER
// order, override control with A2 full-replacement semantics (note replaces,
// classification null reverts), user_overridden + engine-disagrees badges,
// the loud lostOverrides banner, and the rendering law (M1-02): every
// requirementText/rationale/overrideNote renders as escaped interpolation
// only. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FitReportGapsResponse, GapResponse } from '@careerforge/core';

import GapSection from '../app/components/GapSection.vue';

const { getFitReportGapsMock, overrideGapMock } = vi.hoisted(() => ({
  getFitReportGapsMock: vi.fn(),
  overrideGapMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getFitReportGaps: getFitReportGapsMock,
  overrideGap: overrideGapMock,
}));

function gapFixture(overrides: Partial<GapResponse> = {}): GapResponse {
  return {
    id: 'fictional-gap-1',
    fitReportId: 'fictional-report-1',
    requirementId: 'fictional-requirement-1',
    classification: 'genuine_gap',
    engineClassification: 'genuine_gap',
    rationale: 'No named-skill evidence.',
    userOverridden: false,
    overrideNote: null,
    carriedVia: null,
    createdAt: '2026-07-18T12:00:00.000Z',
    requirementText: 'Kubernetes cluster operations',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    ...overrides,
  };
}

function gapsFixture(gaps: GapResponse[], lostOverrides = 0): FitReportGapsResponse {
  return { gaps, lostOverrides };
}

// Each mount gets a UNIQUE report id: the component keys its useAsyncData
// by report id, and Nuxt caches payloads by key across mounts within one
// runtime — a shared id would leak the first test's payload into the rest.
let mountSequence = 0;
async function mountSection() {
  mountSequence += 1;
  return mountSuspended(GapSection, {
    props: { reportId: `fictional-report-${mountSequence}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GapSection', () => {
  it('groups rows by classification in LADDER order with counts and requirement fields', async () => {
    getFitReportGapsMock.mockResolvedValue(
      gapsFixture([
        gapFixture({ id: 'g-gap', classification: 'genuine_gap' }),
        gapFixture({
          id: 'g-have',
          classification: 'have',
          engineClassification: 'have',
          requirementText: 'TypeScript platform work',
        }),
        gapFixture({
          id: 'g-refresh',
          classification: 'needs_refresh',
          engineClassification: 'needs_refresh',
        }),
      ]),
    );
    const wrapper = await mountSection();
    const groups = wrapper.findAll('[data-testid="gap-group"] h3');
    expect(groups.map((group) => group.text().replace(/\s+/g, ' ').trim())).toEqual([
      'Have 1',
      'Needs refresh 1',
      'Genuine gap 1',
    ]);
    const firstRow = wrapper.find('[data-testid="gap-row"]');
    expect(firstRow.text()).toContain('TypeScript platform work');
    expect(firstRow.text()).toContain('must_have');
    expect(firstRow.text()).toContain('other');
  });

  it('shows the loud lostOverrides banner only when overrides were lost', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsFixture([gapFixture()], 2));
    const wrapper = await mountSection();
    const banner = wrapper.find('[data-testid="gap-lost-overrides"]');
    expect(banner.exists()).toBe(true);
    expect(banner.attributes('role')).toBe('alert');
    expect(banner.text()).toContain('2 overrides from a previous extraction did not carry');
  });

  it('renders the R3 empty shape without a banner', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsFixture([], 0));
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="gap-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="gap-lost-overrides"]').exists()).toBe(false);
  });

  it('badges an overridden row, its carry, and an engine disagreement', async () => {
    getFitReportGapsMock.mockResolvedValue(
      gapsFixture([
        gapFixture({
          classification: 'have',
          engineClassification: 'genuine_gap',
          userOverridden: true,
          overrideNote: 'fictional why note',
          carriedVia: 'requirement_id',
        }),
      ]),
    );
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="gap-overridden"]').text()).toContain('overridden (carried)');
    expect(wrapper.find('[data-testid="gap-engine-disagrees"]').text()).toContain(
      'engine says: Genuine gap',
    );
    expect(wrapper.find('[data-testid="gap-note"]').text()).toBe('fictional why note');
  });

  it('saves an override with the drafted note and refetches (A2: the note sent replaces)', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsFixture([gapFixture()]));
    overrideGapMock.mockResolvedValue(gapFixture({ userOverridden: true }));
    const wrapper = await mountSection();

    await wrapper.find('[data-testid="gap-override-button"]').trigger('click');
    await wrapper.find('[data-testid="gap-select"]').setValue('have_undemonstrated');
    await wrapper.find('[data-testid="gap-note-input"]').setValue('ran it at a fictional job');
    await wrapper.find('[data-testid="gap-save-override"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(overrideGapMock).toHaveBeenCalledWith('fictional-gap-1', {
      classification: 'have_undemonstrated',
      note: 'ran it at a fictional job',
    });
    expect(getFitReportGapsMock).toHaveBeenCalledTimes(2);
  });

  it('an empty note draft sends note null (clears any stored note)', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsFixture([gapFixture()]));
    overrideGapMock.mockResolvedValue(gapFixture({ userOverridden: true }));
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="gap-override-button"]').trigger('click');
    await wrapper.find('[data-testid="gap-select"]').setValue('low_priority');
    await wrapper.find('[data-testid="gap-save-override"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(overrideGapMock).toHaveBeenCalledWith('fictional-gap-1', {
      classification: 'low_priority',
      note: null,
    });
  });

  it('revert sends classification null and no note key (the D6 un-override)', async () => {
    getFitReportGapsMock.mockResolvedValue(
      gapsFixture([gapFixture({ userOverridden: true, classification: 'have' })]),
    );
    overrideGapMock.mockResolvedValue(gapFixture());
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="gap-override-button"]').trigger('click');
    await wrapper.find('[data-testid="gap-revert"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(overrideGapMock).toHaveBeenCalledWith('fictional-gap-1', { classification: null });
  });

  it('hostile posting-derived and user text stays inert on every rendered field', async () => {
    const hostile = '<script>window.__gapPwned = true<' + '/script><img src=x onerror="x">';
    getFitReportGapsMock.mockResolvedValue(
      gapsFixture([
        gapFixture({
          requirementText: hostile,
          rationale: hostile,
          userOverridden: true,
          overrideNote: hostile,
        }),
      ]),
    );
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="gap-section"] script').exists()).toBe(false);
    expect(wrapper.find('[data-testid="gap-section"] img').exists()).toBe(false);
    expect((globalThis as Record<string, unknown>).__gapPwned).toBeUndefined();
    expect(wrapper.find('[data-testid="gap-row"]').text()).toContain('<script>');
  });
});
