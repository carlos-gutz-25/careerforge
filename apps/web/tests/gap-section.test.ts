// Gap classification UI (M1-11): report-scoped gap set grouped in LADDER
// order, override control with A2 full-replacement semantics (note replaces,
// classification null reverts), user_overridden + engine-disagrees badges,
// the loud lostOverrides banner, and the rendering law (M1-02): every
// requirementText/rationale/overrideNote renders as escaped interpolation
// only. All data fictional.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Runtime core import is fine HERE (vitest/node) — the law below bans it
// from the app bundle only.
import {
  GAP_CLASSIFICATIONS,
  type FitReportGapsResponse,
  type GapResponse,
} from '@careerforge/core';

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

  it('the override select offers exactly the five buckets (no drift from core)', async () => {
    getFitReportGapsMock.mockResolvedValue(gapsFixture([gapFixture()]));
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="gap-override-button"]').trigger('click');
    const options = wrapper
      .findAll('[data-testid="gap-select"] option')
      .map((option) => option.attributes('value'));
    // Same SET as core's enum; the component's local list exists so the app
    // bundle stays free of runtime core imports (the types-only law).
    expect(new Set(options)).toEqual(new Set(GAP_CLASSIFICATIONS));
    expect(options).toHaveLength(GAP_CLASSIFICATIONS.length);
  });

  it('the app bundle imports core TYPES ONLY (the zod-free-client law, source-pinned)', () => {
    // The M1-11 e2e catch: ONE runtime value import from @careerforge/core
    // pulled zod into the client graph and vite's dev optimizer
    // force-reloaded mid-navigation. Pin the law at the source level: every
    // core import under app/ must be type-only.
    // import.meta.url is not a file: URL under the Nuxt test runtime —
    // resolve from cwd, which is the web project dir or the repo root.
    const appDir = [join(process.cwd(), 'app'), join(process.cwd(), 'apps', 'web', 'app')].find(
      (candidate) => existsSync(candidate),
    );
    if (!appDir) throw new Error('web app dir not found from cwd');
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          visit(path);
          continue;
        }
        if (!/\.(ts|vue)$/.test(entry)) continue;
        const source = readFileSync(path, 'utf8');
        const importPattern = /import\s+([^;]*?)from\s+'@careerforge\/core'/g;
        for (const match of source.matchAll(importPattern)) {
          const clause = match[1] ?? '';
          const inlineTypesOnly =
            clause.trim().startsWith('type ') ||
            (clause.includes('{') &&
              clause
                .replace(/[{}]/g, '')
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean)
                .every((part) => part.startsWith('type ')));
          if (!inlineTypesOnly) offenders.push(path);
        }
      }
    };
    visit(appDir);
    expect(offenders).toEqual([]);
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
