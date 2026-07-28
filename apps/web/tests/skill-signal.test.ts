// Skill Signal page (M9-03 UI) - the read surface for the market-signal
// aggregation (M9-02, GET /market-signal). Deterministic, LLM-free: recurrence
// arithmetic over the caller's OWN saved postings, grouped into Sharpen / Prove /
// Build / Certify buckets, each explained ENTIRELY by emitted counts (never a
// composite score). The honesty string renders verbatim; the cohort disclosure
// (D5) is never silent; an empty cohort is a valid report. Group displayText and
// certification matchedTerms are posting-derived and UNTRUSTED - {{ }} only.
// All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GAP_CLASSIFICATIONS,
  marketSignalNoActionReasonSchema,
  type MarketSignalGroup,
  type MarketSignalNoActionGroup,
  type MarketSignalReport,
} from '@careerforge/core';

import SkillSignalPage from '../app/pages/skill-signal.vue';

const { getMarketSignalMock } = vi.hoisted(() => ({
  getMarketSignalMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getMarketSignal: getMarketSignalMock,
}));

function group(overrides: Partial<MarketSignalGroup> = {}): MarketSignalGroup {
  return {
    key: 'kubernetes',
    displayText: 'Kubernetes',
    postingCount: 7,
    instanceCount: 11,
    mustHavePostingCount: 5,
    niceToHavePostingCount: 2,
    excludedPostingCount: 1,
    bestEvidenceWeight: 0.8,
    meanEvidenceWeight: 0.55,
    classificationCounts: {
      have: 3,
      have_undemonstrated: 2,
      needs_refresh: 1,
      genuine_gap: 1,
      low_priority: 0,
    },
    overriddenCount: 2,
    categories: ['framework', 'domain'],
    refs: [
      { gapId: 'g-1', postingId: 'p-1', fitReportId: 'f-1', classification: 'genuine_gap' },
      { gapId: 'g-2', postingId: 'p-2', fitReportId: 'f-2', classification: 'have' },
      { gapId: 'g-3', postingId: 'p-3', fitReportId: 'f-3', classification: 'needs_refresh' },
      { gapId: 'g-4', postingId: 'p-4', fitReportId: 'f-4', classification: 'have_undemonstrated' },
    ],
    certification: {
      mentioned: true,
      postingCount: 2,
      matchedTerms: ['CKA', 'Certified Kubernetes Administrator'],
    },
    ...overrides,
  };
}

function noActionGroup(
  overrides: Partial<MarketSignalNoActionGroup> = {},
): MarketSignalNoActionGroup {
  return { ...group(), reason: 'covered_or_low_priority', ...overrides };
}

function emptyCohort(): MarketSignalReport['cohort'] {
  return {
    postingsConsidered: 0,
    postingsWithSignal: 0,
    postingsWithoutReport: 0,
    postingsArchived: 0,
    excludedVerdictPostings: 0,
    draftReports: 0,
    reviewedReports: 0,
    unscoredRequirementsInCohort: 0,
  };
}

function report(overrides: Partial<MarketSignalReport> = {}): MarketSignalReport {
  return {
    scorerVersion: 3,
    honesty:
      'This counts how often the skills in your own saved postings recur. It is not a market forecast.',
    cohort: {
      postingsConsidered: 9,
      postingsWithSignal: 6,
      postingsWithoutReport: 1,
      postingsArchived: 1,
      excludedVerdictPostings: 1,
      draftReports: 2,
      reviewedReports: 4,
      unscoredRequirementsInCohort: 3,
    },
    buckets: { sharpen: [], prove: [], build: [], certify: [] },
    noAction: [],
    groupCount: 0,
    instanceCount: 0,
    ...overrides,
  };
}

describe('skill signal page', () => {
  beforeEach(() => {
    getMarketSignalMock.mockReset();
    clearNuxtData();
  });

  it('renders the honesty string verbatim and the scorer version', async () => {
    const honesty = 'Recurrence over your own postings only - never a market prediction.';
    getMarketSignalMock.mockResolvedValue(report({ honesty, scorerVersion: 5 }));

    const wrapper = await mountSuspended(SkillSignalPage);
    // Verbatim: the exact string, not a paraphrase.
    expect(wrapper.get('[data-testid="skill-signal-honesty"]').text()).toBe(honesty);
    expect(wrapper.get('[data-testid="skill-signal-scorer"]').text()).toContain('5');
  });

  it('discloses the whole cohort - one item per field the server sent, never a subset', async () => {
    const rep = report();
    getMarketSignalMock.mockResolvedValue(rep);

    const wrapper = await mountSuspended(SkillSignalPage);
    const items = wrapper.findAll('[data-testid="cohort-item"]');
    // Every emitted cohort field renders (honesty: nothing silently dropped).
    expect(items).toHaveLength(Object.keys(rep.cohort).length);
    const cohortText = wrapper.get('[data-testid="skill-signal-cohort"]').text();
    expect(cohortText).toContain('Postings considered');
    expect(cohortText).toContain('Reviewed fit reports');
  });

  it('renders the four buckets and a group card explained entirely by emitted counts', async () => {
    getMarketSignalMock.mockResolvedValue(
      report({
        buckets: { sharpen: [group()], prove: [], build: [], certify: [] },
        groupCount: 1,
        instanceCount: 11,
      }),
    );

    const wrapper = await mountSuspended(SkillSignalPage);
    for (const bucket of ['sharpen', 'prove', 'build', 'certify']) {
      expect(wrapper.find(`[data-testid="bucket-${bucket}"]`).exists()).toBe(true);
    }
    // Empty buckets say so; they are never silently blank.
    expect(wrapper.find('[data-testid="bucket-prove"] [data-testid="bucket-empty"]').exists()).toBe(
      true,
    );

    const card = wrapper.get('[data-testid="signal-group-card"]');
    expect(card.get('[data-testid="group-display"]').text()).toBe('Kubernetes');
    // Explainable counts, not a score.
    const counts = card.get('[data-testid="group-counts"]').text();
    expect(counts).toContain('7'); // postings asking
    expect(counts).toContain('5'); // as a must-have
    // Evidence weight is the engine currency, shown verbatim (rounded to display).
    const weight = card.get('[data-testid="group-evidence-weight"]').text();
    expect(weight).toContain('0.80');
    expect(weight).toContain('0.55');
    // All five classification rows, always present (honesty).
    expect(card.findAll('[data-testid="classification-row"]')).toHaveLength(5);
    expect(card.get('[data-testid="group-classifications"]').text()).toContain('Genuine gap');
    expect(card.get('[data-testid="group-overridden"]').text()).toContain('2');
    // Certification evidence: counts + matched terms, never advice.
    const cert = card.get('[data-testid="group-certification"]').text();
    expect(cert).toContain('2');
    expect(cert).toContain('CKA');
    // Refs shown as a count (the raw ids are a future nav surface, not rendered).
    expect(card.get('[data-testid="group-refs"]').text()).toContain('4 linked gaps');
    expect(card.text()).not.toContain('g-1');
  });

  it('an empty cohort is valid: honesty + cohort still render, the empty state shows, no buckets', async () => {
    getMarketSignalMock.mockResolvedValue(report({ cohort: emptyCohort() }));

    const wrapper = await mountSuspended(SkillSignalPage);
    // The disclosure is never a blank: honesty and cohort still render.
    expect(wrapper.find('[data-testid="skill-signal-honesty"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="cohort-item"]')).toHaveLength(
      Object.keys(emptyCohort()).length,
    );
    // Empty state instead of bucket sections.
    expect(wrapper.find('[data-testid="skill-signal-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="bucket-sharpen"]').exists()).toBe(false);
  });

  it('the noAction section is fully reported with each reason label', async () => {
    getMarketSignalMock.mockResolvedValue(
      report({
        noAction: [
          noActionGroup({ key: 'excluded-one', reason: 'all_postings_excluded' }),
          noActionGroup({ key: 'covered-one', reason: 'covered_or_low_priority' }),
        ],
      }),
    );

    const wrapper = await mountSuspended(SkillSignalPage);
    const section = wrapper.get('[data-testid="no-action-section"]');
    expect(section.findAll('[data-testid="signal-group-card"]')).toHaveLength(2);
    const reasons = section.findAll('[data-testid="group-reason"]').map((r) => r.text());
    expect(reasons).toContain('Every asking posting is excluded');
    expect(reasons).toContain('Covered or low priority');
  });

  it('the local display vocab is complete against every core gap classification and noAction reason', async () => {
    // A missing classification key would leave a blank label; a missing reason
    // key would leave a blank chip. Iterate the core enum / schema and assert a
    // real label renders for every member (the runtime pin behind Record<Enum,_>).
    for (const classification of GAP_CLASSIFICATIONS) {
      getMarketSignalMock.mockResolvedValue(
        report({ buckets: { sharpen: [group()], prove: [], build: [], certify: [] } }),
      );
      clearNuxtData();
      const wrapper = await mountSuspended(SkillSignalPage);
      // Each classification renders a non-empty label somewhere in the split.
      const rows = wrapper
        .findAll('[data-testid="classification-row"]')
        .map((r) => r.get('.sig-class-label').text().trim());
      expect(rows.every((label) => label.length > 0)).toBe(true);
      expect(rows).toHaveLength(GAP_CLASSIFICATIONS.length);
      // The classification is a real key on the counts (compile + runtime).
      expect(group().classificationCounts[classification]).toBeTypeOf('number');
    }

    for (const reason of marketSignalNoActionReasonSchema.options) {
      getMarketSignalMock.mockResolvedValue(report({ noAction: [noActionGroup({ reason })] }));
      clearNuxtData();
      const wrapper = await mountSuspended(SkillSignalPage);
      expect(wrapper.get('[data-testid="group-reason"]').text().trim().length).toBeGreaterThan(0);
    }
  });

  it('hostile group displayText / matched terms render inert (interpolation, not markup)', async () => {
    const xss = '<img src=x onerror="document.body.dataset.xss=1">';
    getMarketSignalMock.mockResolvedValue(
      report({
        buckets: {
          sharpen: [
            group({
              displayText: xss,
              certification: { mentioned: true, postingCount: 1, matchedTerms: [xss] },
            }),
          ],
          prove: [],
          build: [],
          certify: [],
        },
      }),
    );

    const wrapper = await mountSuspended(SkillSignalPage);
    expect(wrapper.element.querySelector('img')).toBeNull();
    expect(wrapper.text()).toContain('<img');
    expect((document.body.dataset as Record<string, string | undefined>).xss).toBeUndefined();
  });
});
