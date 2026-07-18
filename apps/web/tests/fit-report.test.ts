// Fit report UI (M1-10): the 7-dimension breakdown with two-sided evidence,
// prominent verification-state treatment (inputFlagged, unscored rows),
// explicit exclusion rendering (never a low score), the forced-lowest policy
// flag beside an HONEST priority number, one-shot review, and the extract/
// score triggers with their pending states. Rendering law (M1-02): every
// quote/rationale/notes field is escaped interpolation only — and NO merged
// "match %" may be displayed or synthesized anywhere (the percent-free pin
// below is the story's headline tripwire). All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FitReportResponse,
  PostingDetail,
  PostingRequirementsResponse,
  Requirement,
} from '@careerforge/core';

import FitReportSection from '../app/components/FitReportSection.vue';
import PostingDetailPage from '../app/pages/postings/[id].vue';
import { ApiError } from '../app/utils/api-error.ts';

const {
  getPostingMock,
  listApplicationsMock,
  getPostingRequirementsMock,
  getPostingFitMock,
  extractPostingMock,
  scorePostingFitMock,
  reviewFitReportMock,
  routeState,
} = vi.hoisted(() => ({
  getPostingMock: vi.fn(),
  listApplicationsMock: vi.fn(),
  getPostingRequirementsMock: vi.fn(),
  getPostingFitMock: vi.fn(),
  extractPostingMock: vi.fn(),
  scorePostingFitMock: vi.fn(),
  reviewFitReportMock: vi.fn(),
  routeState: {
    params: { id: 'fictional-posting-id' } as Record<string, string>,
    query: {} as Record<string, unknown>,
  },
}));

mockNuxtImport('useApi', () => () => ({
  getPosting: getPostingMock,
  updatePostingStatus: vi.fn(),
  listApplications: listApplicationsMock,
  createApplication: vi.fn(),
  getPostingRequirements: getPostingRequirementsMock,
  getPostingFit: getPostingFitMock,
  extractPosting: extractPostingMock,
  scorePostingFit: scorePostingFitMock,
  reviewFitReport: reviewFitReportMock,
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
    status: 'extracted',
    createdAt: '2026-07-15T12:00:00.000Z',
    rawText: 'Requirements: 5+ years TypeScript.',
    ...overrides,
  };
}

function requirementFixture(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'fictional-requirement-1',
    kind: 'must_have',
    category: 'language',
    text: 'TypeScript experience',
    sourceQuote: '5+ years TypeScript',
    quoteVerified: true,
    confidence: 0.95,
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

function reportFixture(overrides: Partial<FitReportResponse> = {}): FitReportResponse {
  return {
    id: 'fictional-report-id',
    postingId: 'fictional-posting-id',
    extractionRunId: 'fictional-run-id',
    reviewStatus: 'draft',
    notes: null,
    createdAt: '2026-07-18T12:00:00.000Z',
    report: {
      verdict: 'scored',
      exclusions: [],
      subScores: [
        'min_quals',
        'technical',
        'domain',
        'seniority',
        'comp_location',
        'priority',
        'stretch',
      ].map((dimension) => ({
        dimension: dimension as never,
        score: 0.5,
        rationale: `fictional ${dimension} rationale`,
        evidence:
          dimension === 'technical'
            ? [
                {
                  requirementId: 'fictional-requirement-1',
                  profileSkillId: 'fictional-skill-1',
                  profileProjectId: null,
                  profileExperienceId: null,
                  postingQuote: '5+ years TypeScript',
                  profileQuote: 'typescript — expert, 8 yrs',
                  strength: 'direct' as const,
                },
              ]
            : [],
      })),
      unscoredRequirements: [],
      forcedLowestPriority: { applied: false, matchedSlugs: [] },
      inputFlagged: false,
    },
    ...overrides,
  };
}

const HOSTILE =
  '<script>document.body.dataset.xssExecuted = "fictional-marker"</script>' +
  '<img src=x onerror="document.body.dataset.xssExecuted = \'fictional-marker\'">';

describe('fit report section (component)', () => {
  beforeEach(() => {
    reviewFitReportMock.mockReset();
    delete document.body.dataset.xssExecuted;
  });

  it('renders all 7 sub-scores with honest 0–1 values and NO merged percent anywhere', async () => {
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report: reportFixture(), requirements: [requirementFixture()] },
    });
    const rows = wrapper.findAll('[data-testid="fit-subscore"]');
    expect(rows).toHaveLength(7);
    expect(rows[0]?.text()).toContain('Minimum qualifications');
    expect(rows[0]?.text()).toContain('0.50');
    // THE story law, strongest form: no single merged "match %" may be
    // displayed or synthesized. The fixture is percent-free, so ANY percent
    // in the rendered section is a synthesized aggregate — fail loudly.
    expect(wrapper.get('[data-testid="fit-section"]').text()).not.toMatch(/\d\s*%/);
    expect(wrapper.get('[data-testid="fit-section"]').text()).not.toMatch(/match\s*(score|%)/i);
  });

  it('clickable evidence: posting and profile quotes side by side inside a details expander', async () => {
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report: reportFixture(), requirements: [requirementFixture()] },
    });
    const evidence = wrapper.get('[data-testid="fit-evidence"]');
    expect(evidence.element.tagName).toBe('DETAILS');
    expect(evidence.get('summary').text()).toContain('direct');
    expect(evidence.get('[data-testid="evidence-posting-quote"]').text()).toBe(
      '5+ years TypeScript',
    );
    expect(evidence.get('[data-testid="evidence-profile-quote"]').text()).toBe(
      'typescript — expert, 8 yrs',
    );
  });

  it('hostile quotes, rationale, and notes render INERT (same law as rawText)', async () => {
    const report = reportFixture({ reviewStatus: 'reviewed', notes: HOSTILE });
    report.report.subScores[1]!.evidence = [
      {
        requirementId: 'fictional-requirement-1',
        profileSkillId: 'fictional-skill-1',
        profileProjectId: null,
        profileExperienceId: null,
        postingQuote: HOSTILE,
        profileQuote: HOSTILE,
        strength: 'direct',
      },
    ];
    report.report.subScores[1]!.rationale = HOSTILE;
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report, requirements: [requirementFixture()] },
    });
    const postingQuote = wrapper.get('[data-testid="evidence-posting-quote"]');
    expect(postingQuote.element.children.length).toBe(0);
    expect(postingQuote.element.textContent).toBe(HOSTILE);
    const notes = wrapper.get('[data-testid="fit-reviewed"] pre');
    expect(notes.element.children.length).toBe(0);
    expect(notes.element.textContent).toBe(HOSTILE);
    expect(document.body.dataset.xssExecuted).toBeUndefined();
  });

  it('inputFlagged renders the role=alert banner; absent on clean reports', async () => {
    const flagged = reportFixture();
    flagged.report.inputFlagged = true;
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report: flagged, requirements: [] },
    });
    expect(wrapper.get('[data-testid="fit-input-flagged"]').attributes('role')).toBe('alert');

    const clean = await mountSuspended(FitReportSection, {
      props: { report: reportFixture(), requirements: [] },
    });
    expect(clean.find('[data-testid="fit-input-flagged"]').exists()).toBe(false);
  });

  it('an excluded verdict renders the explicit quote-cited exclusion block — with the breakdown intact', async () => {
    const excluded = reportFixture();
    excluded.report.verdict = 'excluded';
    excluded.report.exclusions = [
      {
        filterKey: 'employment_type',
        matchedValue: 'contract',
        postingQuote: 'This is a contract position.',
      },
    ];
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report: excluded, requirements: [] },
    });
    const block = wrapper.get('[data-testid="fit-exclusions"]');
    expect(block.text()).toContain('policy exclusion');
    expect(block.text()).toContain('employment_type');
    expect(block.get('pre').text()).toBe('This is a contract position.');
    // The informative breakdown stays — exclusion is never "scores hidden".
    expect(wrapper.findAll('[data-testid="fit-subscore"]')).toHaveLength(7);
  });

  it('forced-lowest: policy chip + cap marker beside the HONEST priority number when applied, absent otherwise', async () => {
    const capped = reportFixture();
    capped.report.forcedLowestPriority = { applied: true, matchedSlugs: ['defense'] };
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report: capped, requirements: [] },
    });
    const chip = wrapper.get('[data-testid="fit-forced-lowest"]');
    expect(chip.text()).toContain('bottom tier');
    expect(chip.text()).toContain('defense');
    expect(wrapper.get('[data-testid="fit-priority-cap-marker"]').text()).toContain('capped');
    // The priority row still shows the honest computed value — never clamped.
    const priorityRow = wrapper
      .findAll('[data-testid="fit-subscore"]')
      .find((row) => row.text().includes('Priority'));
    expect(priorityRow?.text()).toContain('0.50');

    const plain = await mountSuspended(FitReportSection, {
      props: { report: reportFixture(), requirements: [] },
    });
    expect(plain.find('[data-testid="fit-forced-lowest"]').exists()).toBe(false);
    expect(plain.find('[data-testid="fit-priority-cap-marker"]').exists()).toBe(false);
  });

  it('unscored rows render loudly with verification-state labels and cross-referenced requirement text', async () => {
    const withUnscored = reportFixture();
    withUnscored.report.unscoredRequirements = [
      { requirementId: 'fictional-requirement-1', reason: 'failed_verification' },
      { requirementId: 'fictional-requirement-unknown', reason: 'not_yet_verified' },
    ];
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report: withUnscored, requirements: [requirementFixture()] },
    });
    const unscored = wrapper.get('[data-testid="fit-unscored"]');
    expect(unscored.text()).toContain('2 requirements excluded from scoring');
    expect(unscored.text()).toContain('TypeScript experience'); // cross-referenced
    expect(unscored.text()).toContain('quote failed verification');
    expect(unscored.text()).toContain('quote not yet verified');
    expect(unscored.text()).toContain('fictional-requirement-unknown'); // id fallback
  });

  it('review: draft shows the form, submit sends trimmed-or-null notes and emits reviewed; reviewed shows notes, no form', async () => {
    reviewFitReportMock.mockResolvedValue({
      id: 'fictional-report-id',
      reviewStatus: 'reviewed',
      notes: null,
    });
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report: reportFixture(), requirements: [] },
    });
    expect(wrapper.find('[data-testid="fit-review-form"]').exists()).toBe(true);
    await wrapper.get('[data-testid="fit-mark-reviewed"]').trigger('click');
    await vi.waitFor(() =>
      expect(reviewFitReportMock).toHaveBeenCalledWith('fictional-report-id', { notes: null }),
    );
    expect(wrapper.emitted('reviewed')).toBeTruthy();

    const reviewed = await mountSuspended(FitReportSection, {
      props: {
        report: reportFixture({ reviewStatus: 'reviewed', notes: 'fictional review note' }),
        requirements: [],
      },
    });
    expect(reviewed.find('[data-testid="fit-review-form"]').exists()).toBe(false);
    expect(reviewed.get('[data-testid="fit-reviewed"]').text()).toContain('Reviewed');
    expect(reviewed.get('[data-testid="fit-reviewed"] pre').text()).toBe('fictional review note');
  });

  it('surfaces the API review error (409 already-reviewed) as received', async () => {
    reviewFitReportMock.mockRejectedValue(
      new ApiError(409, 'REPORT_ALREADY_REVIEWED', 'fit report is already reviewed'),
    );
    const wrapper = await mountSuspended(FitReportSection, {
      props: { report: reportFixture(), requirements: [] },
    });
    await wrapper.get('[data-testid="fit-mark-reviewed"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="fit-review-form"] [role="alert"]').text()).toContain(
        'already reviewed',
      ),
    );
  });
});

describe('posting detail triggers (M1-10)', () => {
  beforeEach(() => {
    getPostingMock.mockReset();
    listApplicationsMock.mockReset();
    getPostingRequirementsMock.mockReset();
    getPostingFitMock.mockReset();
    extractPostingMock.mockReset();
    scorePostingFitMock.mockReset();
    getPostingMock.mockResolvedValue(detailFixture({ status: 'new' }));
    listApplicationsMock.mockResolvedValue({ applications: [] });
    getPostingRequirementsMock.mockResolvedValue({ run: null, requirements: [] });
    getPostingFitMock.mockResolvedValue({ report: null });
    clearNuxtData();
  });

  it('no extraction yet: the extract trigger shows; clicking fires ONCE, disables, and shows the pending state', async () => {
    let settleExtraction!: () => void;
    extractPostingMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settleExtraction = () => resolve();
        }),
    );
    const wrapper = await mountSuspended(PostingDetailPage);
    const button = wrapper.get('[data-testid="extract-button"]');
    expect(button.text()).toBe('Extract requirements');

    await button.trigger('click');
    await vi.waitFor(() => expect(extractPostingMock).toHaveBeenCalledTimes(1));
    expect(button.attributes('disabled')).toBeDefined(); // fire-once
    const pending = wrapper.get('[data-testid="extract-pending"]');
    expect(pending.attributes('role')).toBe('status');
    expect(pending.text()).toContain('10–20 seconds');
    // A second click while in flight does nothing (disabled).
    await button.trigger('click');
    expect(extractPostingMock).toHaveBeenCalledTimes(1);
    settleExtraction();
  });

  it('extraction errors surface in the role=alert error line (503 no-provider message as received)', async () => {
    extractPostingMock.mockRejectedValue(
      new ApiError(503, 'LLM_NOT_CONFIGURED', 'no LLM provider configured — set ANTHROPIC_API_KEY'),
    );
    const wrapper = await mountSuspended(PostingDetailPage);
    await wrapper.get('[data-testid="extract-button"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="extract-error"]').text()).toContain('no LLM provider'),
    );
  });

  it('with a run and no report: Score fit shows and calls the POST; with a report: Re-score fit', async () => {
    getPostingMock.mockResolvedValue(detailFixture());
    getPostingRequirementsMock.mockResolvedValue({
      run: runFixture(),
      requirements: [requirementFixture()],
    });
    scorePostingFitMock.mockResolvedValue(reportFixture());
    const wrapper = await mountSuspended(PostingDetailPage);
    const button = wrapper.get('[data-testid="score-fit-button"]');
    expect(button.text()).toBe('Score fit');
    await button.trigger('click');
    await vi.waitFor(() => expect(scorePostingFitMock).toHaveBeenCalledTimes(1));

    clearNuxtData();
    getPostingFitMock.mockResolvedValue({ report: reportFixture() });
    const withReport = await mountSuspended(PostingDetailPage);
    expect(withReport.get('[data-testid="score-fit-button"]').text()).toBe('Re-score fit');
    expect(withReport.find('[data-testid="fit-section"]').exists()).toBe(true);
  });

  it('archived postings show NO triggers but still render an existing report (reads never archived-gated)', async () => {
    getPostingMock.mockResolvedValue(detailFixture({ status: 'archived' }));
    getPostingRequirementsMock.mockResolvedValue({
      run: runFixture(),
      requirements: [requirementFixture()],
    });
    getPostingFitMock.mockResolvedValue({ report: reportFixture() });
    const wrapper = await mountSuspended(PostingDetailPage);
    expect(wrapper.find('[data-testid="extract-trigger"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="fit-trigger"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="fit-section"]').exists()).toBe(true);
  });

  it('the fit fetch failing degrades to no section — the posting still renders', async () => {
    getPostingFitMock.mockRejectedValue(new Error('api down'));
    const wrapper = await mountSuspended(PostingDetailPage);
    expect(wrapper.find('[data-testid="fit-section"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="posting-raw"]').text()).toContain('TypeScript');
  });
});
