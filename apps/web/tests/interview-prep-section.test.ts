// Interview prep section (M3-04 UI, M8-11): the drafting flow (review-gated
// trigger, fire-once), the per-question render with its two talking-point
// shapes - CITED evidence (posting/profile quotes in an expander) and an
// HONEST gap disclosure (the gap row's live classification + learning-plan
// pointers) - the one-shot review, and the rendering law (M1-02): every
// LLM/posting-derived field is escaped interpolation only. All data
// fictional. Mounts the component directly with props, like fit-report.test.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FitReportResponse,
  InterviewPrepQuestion,
  InterviewPrepResponse,
  InterviewPrepRun,
} from '@careerforge/core';

import InterviewPrepSection from '../app/components/InterviewPrepSection.vue';
import { ApiError } from '../app/utils/api-error.ts';

const { getInterviewPrepMock, draftInterviewPrepMock, reviewInterviewPrepMock } = vi.hoisted(
  () => ({
    getInterviewPrepMock: vi.fn(),
    draftInterviewPrepMock: vi.fn(),
    reviewInterviewPrepMock: vi.fn(),
  }),
);

mockNuxtImport('useApi', () => () => ({
  getInterviewPrep: getInterviewPrepMock,
  draftInterviewPrep: draftInterviewPrepMock,
  reviewInterviewPrep: reviewInterviewPrepMock,
}));

// The component reads only `id` and `reviewStatus` off the report prop; a
// minimal object cast keeps the fixture from restating the whole fit shape.
function reportFixture(reviewStatus: 'draft' | 'reviewed'): FitReportResponse {
  return { id: 'fictional-report-id', reviewStatus } as unknown as FitReportResponse;
}

function runFixture(status: InterviewPrepRun['status'] = 'ok'): InterviewPrepRun {
  return {
    id: 'fictional-run-id',
    promptId: 'interview-prep@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    status,
    attempt: 1,
    inputTokens: 1400,
    outputTokens: 600,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 8000,
    createdAt: '2026-07-18T12:00:00.000Z',
  };
}

function evidenceQuestion(overrides: Partial<InterviewPrepQuestion> = {}): InterviewPrepQuestion {
  return {
    id: 'fictional-question-1',
    kind: 'technical',
    question: 'Walk through a TypeScript system you built.',
    position: 0,
    requirementId: 'fictional-requirement-1',
    requirementText: 'TypeScript experience',
    requirementKind: 'must_have',
    requirementCategory: 'language',
    points: [
      {
        id: 'fictional-point-1',
        type: 'evidence',
        text: 'Cite the payments service you built in TypeScript.',
        position: 0,
        evidenceLinkId: 'fictional-link-1',
        evidenceStrength: 'direct',
        evidencePostingQuote: '5+ years TypeScript',
        evidenceProfileQuote: 'typescript - expert, 8 yrs',
      },
    ],
    ...overrides,
  };
}

function gapQuestion(): InterviewPrepQuestion {
  return {
    id: 'fictional-question-2',
    kind: 'behavioral',
    question: 'How would you close a Kubernetes gap?',
    position: 1,
    requirementId: 'fictional-requirement-2',
    requirementText: 'Kubernetes in production',
    requirementKind: 'nice_to_have',
    requirementCategory: 'tool',
    points: [
      {
        id: 'fictional-point-2',
        type: 'gap_disclosure',
        text: 'Be honest: no production Kubernetes yet, but here is the plan.',
        position: 0,
        gapId: 'fictional-gap-1',
        gapClassification: 'stretch',
        learningPlans: [{ id: 'fictional-plan-1', title: 'Kubernetes fundamentals' }],
      },
    ],
  };
}

function prepResponse(
  overrides: Partial<InterviewPrepResponse['prep']> = {},
  run: InterviewPrepRun | null = runFixture(),
): InterviewPrepResponse {
  return {
    run,
    cached: false,
    prep: {
      id: 'fictional-prep-id',
      fitReportId: 'fictional-report-id',
      reviewStatus: 'draft',
      notes: null,
      createdAt: '2026-07-18T12:00:00.000Z',
      questions: [evidenceQuestion(), gapQuestion()],
      ...overrides,
    },
  };
}

const HOSTILE =
  '<script>document.body.dataset.xssExecuted = "fictional-marker"</script>' +
  '<img src=x onerror="document.body.dataset.xssExecuted = \'fictional-marker\'">';

describe('interview prep section (M8-11)', () => {
  beforeEach(() => {
    getInterviewPrepMock.mockReset();
    draftInterviewPrepMock.mockReset();
    reviewInterviewPrepMock.mockReset();
    delete document.body.dataset.xssExecuted;
    clearNuxtData();
  });

  it('review-gate: an unreviewed report shows the gate, not the draft button', async () => {
    getInterviewPrepMock.mockResolvedValue({ run: null, prep: null, cached: false });
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('draft') },
    });
    expect(wrapper.get('[data-testid="ip-review-gate"]').text()).toContain('Review the fit report');
    expect(wrapper.find('[data-testid="ip-draft-button"]').exists()).toBe(false);
  });

  it('reviewed + no prep: the draft button fires the POST once and refreshes', async () => {
    getInterviewPrepMock.mockResolvedValue({ run: null, prep: null, cached: false });
    draftInterviewPrepMock.mockResolvedValue(prepResponse());
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    const button = wrapper.get('[data-testid="ip-draft-button"]');
    expect(button.text()).toContain('Draft interview prep');
    await button.trigger('click');
    await vi.waitFor(() => expect(draftInterviewPrepMock).toHaveBeenCalledTimes(1));
    expect(draftInterviewPrepMock).toHaveBeenCalledWith('fictional-posting-id');
  });

  it('surfaces the API draft error (409 report-not-reviewed) as received', async () => {
    getInterviewPrepMock.mockResolvedValue({ run: null, prep: null, cached: false });
    draftInterviewPrepMock.mockRejectedValue(
      new ApiError(
        409,
        'REPORT_NOT_REVIEWED',
        'review the fit report before drafting interview prep',
      ),
    );
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    await wrapper.get('[data-testid="ip-draft-button"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="ip-draft-error"]').text()).toContain(
        'review the fit report',
      ),
    );
  });

  it('renders questions with kind, requirement citation, evidence quotes, and the gap disclosure', async () => {
    getInterviewPrepMock.mockResolvedValue(prepResponse());
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    const questions = wrapper.findAll('[data-testid="ip-question"]');
    expect(questions).toHaveLength(2);
    // Question 1: technical, cites its requirement, evidence quotes side by side.
    expect(questions[0]?.get('[data-testid="ip-question-kind"]').text()).toBe('technical');
    expect(questions[0]?.get('[data-testid="ip-requirement"]').text()).toContain(
      'TypeScript experience',
    );
    expect(questions[0]?.get('[data-testid="ip-evidence-detail"]').element.tagName).toBe('DETAILS');
    expect(questions[0]?.get('[data-testid="ip-posting-quote"]').text()).toBe(
      '5+ years TypeScript',
    );
    expect(questions[0]?.get('[data-testid="ip-profile-quote"]').text()).toBe(
      'typescript - expert, 8 yrs',
    );
    // Question 2: gap disclosure carries the live classification + a plan link.
    expect(questions[1]?.get('[data-testid="ip-question-kind"]').text()).toBe('behavioral');
    expect(questions[1]?.get('[data-testid="ip-gap-classification"]').text()).toBe('stretch');
    const planLink = questions[1]?.get('[data-testid="ip-learning-plan"]');
    expect(planLink?.text()).toContain('Kubernetes fundamentals');
    expect(planLink?.attributes('href')).toBe('/learning-plans/fictional-plan-1');
  });

  it('hostile question, point, and quote text render INERT (same law as rawText)', async () => {
    getInterviewPrepMock.mockResolvedValue(
      prepResponse({
        questions: [
          evidenceQuestion({
            question: HOSTILE,
            points: [
              {
                id: 'fictional-point-1',
                type: 'evidence',
                text: HOSTILE,
                position: 0,
                evidenceLinkId: 'fictional-link-1',
                evidenceStrength: 'direct',
                evidencePostingQuote: HOSTILE,
                evidenceProfileQuote: HOSTILE,
              },
            ],
          }),
        ],
      }),
    );
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    const quote = wrapper.get('[data-testid="ip-posting-quote"]');
    expect(quote.element.children.length).toBe(0);
    expect(quote.element.textContent).toBe(HOSTILE);
    expect(document.body.dataset.xssExecuted).toBeUndefined();
  });

  it('review: draft shows the form; submit sends trimmed-or-null notes; reviewed shows no form', async () => {
    getInterviewPrepMock.mockResolvedValue(prepResponse());
    reviewInterviewPrepMock.mockResolvedValue({
      id: 'fictional-prep-id',
      reviewStatus: 'reviewed',
      notes: null,
    });
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    expect(wrapper.find('[data-testid="ip-review-form"]').exists()).toBe(true);
    await wrapper.get('[data-testid="ip-mark-reviewed"]').trigger('click');
    await vi.waitFor(() =>
      expect(reviewInterviewPrepMock).toHaveBeenCalledWith('fictional-prep-id', { notes: null }),
    );

    clearNuxtData();
    getInterviewPrepMock.mockResolvedValue(prepResponse({ reviewStatus: 'reviewed' }));
    const reviewed = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    expect(reviewed.find('[data-testid="ip-review-form"]').exists()).toBe(false);
    expect(reviewed.get('[data-testid="ip-reviewed-chip"]').text()).toContain('Reviewed');
  });

  it('a failed drafting run (prep null, run present) renders the loud banner', async () => {
    getInterviewPrepMock.mockResolvedValue({
      run: runFixture('flagged'),
      prep: null,
      cached: false,
    });
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    const banner = wrapper.get('[data-testid="ip-failed-run"]');
    expect(banner.attributes('role')).toBe('alert');
    expect(banner.text()).toContain('flagged');
  });

  it('Run Evidence is a collapsed <details> carrying the run telemetry', async () => {
    getInterviewPrepMock.mockResolvedValue(prepResponse());
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    const runEvidence = wrapper.get('[data-testid="ip-run-evidence"]');
    expect(runEvidence.element.tagName).toBe('DETAILS');
    expect((runEvidence.element as HTMLDetailsElement).open).toBe(false);
    const telemetry = runEvidence.get('[data-testid="ip-telemetry"]').text();
    expect(telemetry).toContain('mock-sonnet');
    expect(telemetry).toContain('interview-prep@v1');
  });

  it('no section when the prep fetch fails (degrade, never block the page)', async () => {
    getInterviewPrepMock.mockRejectedValue(new Error('api down'));
    const wrapper = await mountSuspended(InterviewPrepSection, {
      props: { postingId: 'fictional-posting-id', report: reportFixture('reviewed') },
    });
    expect(wrapper.find('[data-testid="interview-prep-section"]').exists()).toBe(false);
  });
});
