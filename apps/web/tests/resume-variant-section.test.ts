// Resume variant UI (M2-10): report-scoped variant (pin-to-report), tailoring
// trigger gated on a REVIEWED report and fired once, loud flagged/failed-run
// banner, entries grouped by section with emphasis chips + per-entry citation
// fold, the markdown preview, one-shot review, the export button offered ONLY
// when reviewed, the telemetry footer, and the rendering law (M1-02): every
// reason/citation/notes/markdown field renders as escaped interpolation only.
// All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESUME_EMPHASIS_LEVELS,
  RESUME_ENTITY_TYPES,
  type FitReportResponse,
  type FitReportResumeVariantResponse,
  type ResumeVariantEntry,
  type ResumeVariantResponse,
  type ResumeVariantRun,
} from '@careerforge/core';

import ResumeVariantSection from '../app/components/ResumeVariantSection.vue';

const {
  getFitReportResumeVariantMock,
  draftResumeVariantMock,
  reviewResumeVariantMock,
  exportResumeVariantMock,
} = vi.hoisted(() => ({
  getFitReportResumeVariantMock: vi.fn(),
  draftResumeVariantMock: vi.fn(),
  reviewResumeVariantMock: vi.fn(),
  exportResumeVariantMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getFitReportResumeVariant: getFitReportResumeVariantMock,
  draftResumeVariant: draftResumeVariantMock,
  reviewResumeVariant: reviewResumeVariantMock,
  exportResumeVariant: exportResumeVariantMock,
}));

function runFixture(overrides: Partial<ResumeVariantRun> = {}): ResumeVariantRun {
  return {
    id: 'fictional-run-1',
    promptId: 'resume-tailoring@v1',
    provider: 'anthropic',
    model: 'mock-sonnet',
    status: 'ok',
    attempt: 1,
    inputTokens: 2600,
    outputTokens: 640,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 4800,
    createdAt: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

function skillEntry(overrides: Partial<ResumeVariantEntry> = {}): ResumeVariantEntry {
  return {
    id: 'fictional-entry-skill',
    section: 'skill',
    position: 0,
    label: 'TypeScript',
    detail: 'expert · 8 yrs',
    emphasis: 'lead',
    reason: 'Emphasized in light of the language requirement.',
    citations: [
      {
        gapId: 'fictional-gap-1',
        gapClassification: 'have',
        requirementId: 'fictional-req-1',
        requirementText: 'Strong TypeScript background',
        requirementKind: 'must_have',
        requirementCategory: 'language',
      },
    ],
    ...overrides,
  };
}

function experienceEntry(): ResumeVariantEntry {
  return {
    id: 'fictional-entry-exp',
    section: 'experience',
    position: 0,
    label: 'Fictional Gizmo Works, Senior Engineer',
    detail: '2019 - present',
    emphasis: null,
    reason: null,
    citations: [],
  };
}

function projectEntry(): ResumeVariantEntry {
  return {
    id: 'fictional-entry-proj',
    section: 'project',
    position: 0,
    label: 'Reporting Dashboard (personal, AI-assisted)',
    detail: 'A fictional dashboard.',
    emphasis: 'highlight',
    reason: 'Emphasized in light of the dashboards requirement.',
    citations: [
      {
        gapId: 'fictional-gap-2',
        gapClassification: 'genuine_gap',
        requirementId: 'fictional-req-2',
        requirementText: 'Build internal dashboards',
        requirementKind: 'nice_to_have',
        requirementCategory: 'other',
      },
    ],
  };
}

function variantFixture(
  entries: ResumeVariantEntry[],
  overrides: { reviewStatus?: 'draft' | 'reviewed'; notes?: string | null } = {},
): ResumeVariantResponse {
  return {
    id: 'fictional-variant-1',
    fitReportId: 'fictional-report-1',
    reviewStatus: overrides.reviewStatus ?? 'draft',
    notes: overrides.notes ?? null,
    createdAt: '2026-07-23T10:00:01.000Z',
    renderedMarkdown: '# Tailored resume variant (draft)\n\nfictional body\n',
    entries,
  };
}

function variantResponse(
  entries: ResumeVariantEntry[],
  overrides: { reviewStatus?: 'draft' | 'reviewed'; notes?: string | null } = {},
): FitReportResumeVariantResponse {
  return { run: runFixture(), variant: variantFixture(entries, overrides), cached: false };
}

function reportFixture(reviewStatus: 'draft' | 'reviewed' = 'reviewed'): FitReportResponse {
  return {
    id: 'fictional-report-1',
    postingId: 'fictional-posting-1',
    extractionRunId: 'fictional-extraction-run-1',
    reviewStatus,
    notes: null,
    createdAt: '2026-07-23T09:00:00.000Z',
    report: {
      verdict: 'scored',
      exclusions: [],
      subScores: [],
      unscoredRequirements: [],
      forcedLowestPriority: { applied: false, matchedSlugs: [] },
      inputFlagged: false,
    },
  };
}

let mountSequence = 0;
async function mountSection(report: FitReportResponse = reportFixture()) {
  mountSequence += 1;
  return mountSuspended(ResumeVariantSection, {
    props: { reportId: `fictional-report-${mountSequence}`, report },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResumeVariantSection', () => {
  it('gates tailoring on a reviewed report (no button on a draft report)', async () => {
    getFitReportResumeVariantMock.mockResolvedValue({ run: null, variant: null, cached: false });
    const wrapper = await mountSection(reportFixture('draft'));
    expect(wrapper.find('[data-testid="rv-review-gate"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rv-draft-button"]').exists()).toBe(false);
  });

  it('tailors once from a reviewed report and refetches', async () => {
    getFitReportResumeVariantMock.mockResolvedValue({ run: null, variant: null, cached: false });
    draftResumeVariantMock.mockResolvedValue(variantResponse([skillEntry()]));
    const wrapper = await mountSection();

    const button = wrapper.find('[data-testid="rv-draft-button"]');
    expect(button.exists()).toBe(true);
    await button.trigger('click');
    await wrapper.vm.$nextTick();

    expect(draftResumeVariantMock).toHaveBeenCalledTimes(1);
    expect(getFitReportResumeVariantMock).toHaveBeenCalledTimes(2);
  });

  it('renders entries grouped by section in the core vocabulary order, with emphasis + citations', async () => {
    getFitReportResumeVariantMock.mockResolvedValue(
      variantResponse([skillEntry(), experienceEntry(), projectEntry()]),
    );
    const wrapper = await mountSection();

    // Section groups follow the core RESUME_ENTITY_TYPES order exactly (no drift).
    const headings = wrapper.findAll('[data-testid="rv-group"] h3');
    const sectionOrder = headings.map((h) =>
      h
        .text()
        .replace(/\s+\d+$/, '')
        .trim()
        .toLowerCase(),
    );
    expect(sectionOrder).toEqual(
      RESUME_ENTITY_TYPES.map((s) =>
        s === 'skill' ? 'skills' : s === 'project' ? 'projects' : 'experience',
      ),
    );

    const entries = wrapper.findAll('[data-testid="rv-entry"]');
    expect(entries).toHaveLength(3);
    // The skill entry: emphasis chip + reason + a cited requirement.
    const skill = entries[0];
    expect(skill?.find('[data-testid="rv-entry-emphasis"]').text()).toBe('lead');
    expect(skill?.find('[data-testid="rv-entry-reason"]').text()).toContain(
      'Emphasized in light of the language requirement.',
    );
    const citations = skill?.find('[data-testid="rv-entry-citations"]');
    expect(citations?.text()).toContain('Strong TypeScript background');
    expect(citations?.text()).toContain('have');
  });

  it('covers both emphasis levels from the core vocabulary (no drift)', async () => {
    getFitReportResumeVariantMock.mockResolvedValue(
      variantResponse([skillEntry(), projectEntry()]),
    );
    const wrapper = await mountSection();
    const chips = wrapper.findAll('[data-testid="rv-entry-emphasis"]').map((chip) => chip.text());
    expect(new Set(chips)).toEqual(new Set(RESUME_EMPHASIS_LEVELS));
  });

  it('shows the markdown preview as a text node', async () => {
    getFitReportResumeVariantMock.mockResolvedValue(variantResponse([skillEntry()]));
    const wrapper = await mountSection();
    const preview = wrapper.find('[data-testid="rv-preview"]');
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain('# Tailored resume variant (draft)');
  });

  it('shows the loud role=alert banner for a flagged run with no variant', async () => {
    getFitReportResumeVariantMock.mockResolvedValue({
      run: runFixture({ status: 'flagged' }),
      variant: null,
      cached: false,
    });
    const wrapper = await mountSection();
    const banner = wrapper.find('[data-testid="rv-failed-run"]');
    expect(banner.exists()).toBe(true);
    expect(banner.attributes('role')).toBe('alert');
    expect(banner.text()).toContain('flagged');
    // A failed run does not hide the draft button — re-POST is the retry.
    expect(wrapper.find('[data-testid="rv-draft-button"]').exists()).toBe(true);
  });

  it('reviews the draft variant once with notes and refetches', async () => {
    getFitReportResumeVariantMock.mockResolvedValue(variantResponse([skillEntry()]));
    reviewResumeVariantMock.mockResolvedValue({
      id: 'fictional-variant-1',
      reviewStatus: 'reviewed',
      notes: 'Looks honest.',
    });
    const wrapper = await mountSection();

    expect(wrapper.find('[data-testid="rv-draft-chip"]').exists()).toBe(true);
    // Draft: no export button yet.
    expect(wrapper.find('[data-testid="rv-export-button"]').exists()).toBe(false);
    await wrapper.find('[data-testid="rv-review-notes"]').setValue('Looks honest.');
    await wrapper.find('[data-testid="rv-mark-reviewed"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(reviewResumeVariantMock).toHaveBeenCalledWith('fictional-variant-1', {
      notes: 'Looks honest.',
    });
    expect(getFitReportResumeVariantMock).toHaveBeenCalledTimes(2);
  });

  it('a reviewed variant shows the reviewed chip, the export button, and no review form', async () => {
    getFitReportResumeVariantMock.mockResolvedValue(
      variantResponse([skillEntry()], { reviewStatus: 'reviewed', notes: 'Approved.' }),
    );
    exportResumeVariantMock.mockResolvedValue(undefined);
    const wrapper = await mountSection();

    expect(wrapper.find('[data-testid="rv-reviewed-chip"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rv-notes"]').text()).toBe('Approved.');
    expect(wrapper.find('[data-testid="rv-review-form"]').exists()).toBe(false);

    const exportButton = wrapper.find('[data-testid="rv-export-button"]');
    expect(exportButton.exists()).toBe(true);
    await exportButton.trigger('click');
    await wrapper.vm.$nextTick();
    expect(exportResumeVariantMock).toHaveBeenCalledWith('fictional-variant-1');
  });

  it('renders the telemetry footer from the tailoring run', async () => {
    getFitReportResumeVariantMock.mockResolvedValue(variantResponse([skillEntry()]));
    const wrapper = await mountSection();
    const telemetry = wrapper.find('[data-testid="rv-telemetry"]');
    expect(telemetry.exists()).toBe(true);
    const text = telemetry.text().replace(/\s+/g, ' ');
    expect(text).toContain('resume-tailoring@v1');
    expect(text).toContain('2600/640 tok');
    expect(text).toContain('4800 ms');
  });

  it('hostile LLM/posting-derived text stays inert on every rendered field', async () => {
    const hostile = '<script>window.__rvPwned = true<' + '/script><img src=x onerror="x">';
    getFitReportResumeVariantMock.mockResolvedValue(
      variantResponse(
        [
          skillEntry({
            reason: hostile,
            citations: [
              {
                gapId: 'fictional-gap-1',
                gapClassification: 'have',
                requirementId: 'fictional-req-1',
                requirementText: hostile,
                requirementKind: 'must_have',
                requirementCategory: 'language',
              },
            ],
          }),
        ],
        { notes: hostile },
      ),
    );
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="resume-variant-section"] script').exists()).toBe(false);
    expect(wrapper.find('[data-testid="resume-variant-section"] img').exists()).toBe(false);
    expect((globalThis as Record<string, unknown>).__rvPwned).toBeUndefined();
    expect(wrapper.find('[data-testid="rv-entry-reason"]').text()).toContain('<script>');
  });
});
