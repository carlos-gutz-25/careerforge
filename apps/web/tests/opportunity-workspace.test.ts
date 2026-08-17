// Opportunity Workspace tabs (M8-10): the posting detail page presents the
// opportunity lifecycle as staged tabs (Capture -> Extract -> Score -> Gaps ->
// Prepare -> Track). This pins the tab CONTRACT the rest of the suites depend
// on: Capture is the default so the posting text renders on first load (the
// e2e visibility contract), inactive panels stay in the DOM behind the
// `hidden` attribute (so every relocated testid remains reachable), switching
// tabs moves `aria-selected`/`hidden` in lockstep, the Run Evidence panel is a
// collapsed <details> carrying the extraction telemetry, and the downstream
// stages show guiding empty states until their prerequisite exists. All data
// fictional. The rendering-law and per-surface behavior live in the existing
// posting-detail / posting-requirements / fit-report suites - unchanged by the
// regrouping.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostingDetail, PostingRequirementsResponse } from '@careerforge/core';

import PostingDetailPage from '../app/pages/postings/[id].vue';

const { getPostingMock, listApplicationsMock, getPostingRequirementsMock, routeState } = vi.hoisted(
  () => ({
    getPostingMock: vi.fn(),
    listApplicationsMock: vi.fn(),
    getPostingRequirementsMock: vi.fn(),
    routeState: {
      params: { id: 'fictional-posting-id' } as Record<string, string>,
      query: {} as Record<string, unknown>,
    },
  }),
);

mockNuxtImport('useApi', () => () => ({
  getPosting: getPostingMock,
  updatePostingStatus: vi.fn(),
  listApplications: listApplicationsMock,
  createApplication: vi.fn(),
  getPostingRequirements: getPostingRequirementsMock,
  getPostingFit: () => Promise.resolve({ report: null }),
  extractPosting: vi.fn(),
  scorePostingFit: vi.fn(),
  reviewFitReport: vi.fn(),
}));
mockNuxtImport('navigateTo', () => vi.fn());
mockNuxtImport('useRoute', () => () => ({
  path: '/postings/fictional-posting-id',
  fullPath: '/postings/fictional-posting-id',
  params: routeState.params,
  query: routeState.query,
}));

function detailFixture(overrides: Partial<PostingDetail> = {}): PostingDetail {
  return {
    id: 'fictional-posting-id',
    company: 'Fictional Widgets Inc.',
    title: 'Senior Software Engineer',
    sourceNote: null,
    status: 'new',
    createdAt: '2026-07-15T12:00:00.000Z',
    rawText: 'Requirements: 5+ years TypeScript.',
    ...overrides,
  };
}

function runFixture(): PostingRequirementsResponse['run'] {
  return {
    id: 'fictional-run-id',
    promptId: 'extract-requirements@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    status: 'ok',
    attempt: 1,
    inputTokens: 1200,
    outputTokens: 500,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 9000,
    createdAt: '2026-07-17T12:00:00.000Z',
  };
}

const STAGES = ['capture', 'extract', 'score', 'gaps', 'prepare', 'track'] as const;

describe('opportunity workspace tabs (M8-10)', () => {
  beforeEach(() => {
    getPostingMock.mockReset();
    listApplicationsMock.mockReset();
    getPostingRequirementsMock.mockReset();
    getPostingMock.mockResolvedValue(detailFixture());
    listApplicationsMock.mockResolvedValue({ applications: [] });
    getPostingRequirementsMock.mockResolvedValue({ run: null, requirements: [] });
    routeState.query = {};
    clearNuxtData();
  });

  it('renders all six lifecycle tabs as an ARIA tablist, Capture selected by default', async () => {
    const wrapper = await mountSuspended(PostingDetailPage);

    expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe(
      'Opportunity workspace stages',
    );
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs).toHaveLength(6);
    expect(tabs.map((tab) => tab.text())).toEqual([
      'Capture',
      'Extract',
      'Score',
      'Gaps',
      'Prepare',
      'Track',
    ]);

    // Capture is the ONLY selected tab; only its panel is visible.
    expect(wrapper.get('[data-testid="workspace-tab-capture"]').attributes('aria-selected')).toBe(
      'true',
    );
    expect(wrapper.get<HTMLElement>('[data-testid="workspace-panel-capture"]').element.hidden).toBe(
      false,
    );
    for (const stage of STAGES.filter((s) => s !== 'capture')) {
      expect(
        wrapper.get(`[data-testid="workspace-tab-${stage}"]`).attributes('aria-selected'),
      ).toBe('false');
      expect(
        wrapper.get<HTMLElement>(`[data-testid="workspace-panel-${stage}"]`).element.hidden,
      ).toBe(true);
    }
  });

  it('the posting text lives in the Capture panel and is visible on first load', async () => {
    const wrapper = await mountSuspended(PostingDetailPage);
    const capture = wrapper.get<HTMLElement>('[data-testid="workspace-panel-capture"]');
    expect(capture.element.hidden).toBe(false);
    const raw = capture.get('[data-testid="posting-raw"]');
    expect(raw.element.tagName).toBe('PRE');
    expect(raw.text()).toContain('TypeScript');
  });

  it('selecting a tab moves aria-selected and the hidden attribute in lockstep', async () => {
    const wrapper = await mountSuspended(PostingDetailPage);

    await wrapper.get('[data-testid="workspace-tab-extract"]').trigger('click');

    expect(wrapper.get('[data-testid="workspace-tab-extract"]').attributes('aria-selected')).toBe(
      'true',
    );
    expect(wrapper.get<HTMLElement>('[data-testid="workspace-panel-extract"]').element.hidden).toBe(
      false,
    );
    // Capture is deselected and hidden - panels never stack.
    expect(wrapper.get('[data-testid="workspace-tab-capture"]').attributes('aria-selected')).toBe(
      'false',
    );
    expect(wrapper.get<HTMLElement>('[data-testid="workspace-panel-capture"]').element.hidden).toBe(
      true,
    );
  });

  it('ArrowRight on a focused tab moves selection to the next stage', async () => {
    const wrapper = await mountSuspended(PostingDetailPage);

    await wrapper
      .get('[data-testid="workspace-tab-capture"]')
      .trigger('keydown', { key: 'ArrowRight' });

    expect(wrapper.get('[data-testid="workspace-tab-extract"]').attributes('aria-selected')).toBe(
      'true',
    );
    expect(wrapper.get<HTMLElement>('[data-testid="workspace-panel-extract"]').element.hidden).toBe(
      false,
    );
  });

  it('Run Evidence is a collapsed <details> carrying the extraction telemetry', async () => {
    getPostingMock.mockResolvedValue(detailFixture({ status: 'extracted' }));
    getPostingRequirementsMock.mockResolvedValue({
      run: runFixture(),
      requirements: [
        {
          id: 'fictional-requirement-1',
          kind: 'must_have',
          category: 'language',
          text: 'TypeScript experience',
          sourceQuote: '5+ years TypeScript',
          quoteVerified: true,
          confidence: 0.95,
        },
      ],
    });

    const wrapper = await mountSuspended(PostingDetailPage);
    const runEvidence = wrapper.get('[data-testid="run-evidence"]');
    expect(runEvidence.element.tagName).toBe('DETAILS');
    // Collapsed by default - provenance is available, not in the way.
    expect((runEvidence.element as HTMLDetailsElement).open).toBe(false);
    // The telemetry lives inside and is reachable regardless of open state.
    const telemetry = runEvidence.get('[data-testid="extraction-telemetry"]').text();
    expect(telemetry).toContain('mock-sonnet');
    expect(telemetry).toContain('extract-requirements@v1');
    expect(telemetry).toContain('1200 in / 500 out');
  });

  it('downstream stages show guiding empty states until their prerequisite exists', async () => {
    const wrapper = await mountSuspended(PostingDetailPage);

    // No fit report yet -> Score/Gaps/Prepare each guide the next step.
    expect(wrapper.get<HTMLElement>('[data-testid="workspace-panel-score"]').text()).toContain(
      'No fit report yet',
    );
    expect(wrapper.get<HTMLElement>('[data-testid="workspace-panel-gaps"]').text()).toContain(
      'score fit first',
    );
    expect(wrapper.get<HTMLElement>('[data-testid="workspace-panel-prepare"]').text()).toContain(
      'Nothing to prepare yet',
    );
  });

  it('Track panel holds the application + lifecycle actions (untracked shows Track)', async () => {
    const wrapper = await mountSuspended(PostingDetailPage);
    const track = wrapper.get<HTMLElement>('[data-testid="workspace-panel-track"]');
    expect(track.get('[data-testid="track-application"]').text()).toBe('Track application');
    // The archive control lives with tracking, not scattered across the page.
    expect(track.findAll('button').some((b) => /archive/i.test(b.text()))).toBe(true);
  });
});
