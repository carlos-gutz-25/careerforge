// Application gameplan UI (M7-09, over the M7-05/06/07 endpoints, ADR-0019). The
// third LLM-drafted coaching artifact: a per-report strategy for pursuing one
// posting, framed as three views - Apply (phase strategy), Speak (evidence-cited
// STAR stories), Process (the deterministic checklist + application-stage
// timeline). Drafting is review-gated + fire-once; a flagged/failed run persists
// nothing (loud banner); the checklist toggle is the user's own process state
// (allowed pre-review, D6) and the server returns the FULL overlay. Rendering
// law (M1-02): strategy/story text, joined requirement/quote fields, and notes
// all render as escaped interpolation only. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GAMEPLAN_CHECKLIST_TEMPLATES,
  GAMEPLAN_PHASES,
  type ApplicationGameplan,
  type ApplicationGameplanResponse,
  type ApplicationGameplanRun,
  type FitReportResponse,
  type GameplanPhase,
  type GameplanPhaseView,
  type GameplanStoryWire,
} from '@careerforge/core';

import GameplanSection from '../app/components/GameplanSection.vue';

const { getGameplanMock, draftGameplanMock, reviewGameplanMock, toggleGameplanCheckMock } =
  vi.hoisted(() => ({
    getGameplanMock: vi.fn(),
    draftGameplanMock: vi.fn(),
    reviewGameplanMock: vi.fn(),
    toggleGameplanCheckMock: vi.fn(),
  }));

mockNuxtImport('useApi', () => () => ({
  getGameplan: getGameplanMock,
  draftGameplan: draftGameplanMock,
  reviewGameplan: reviewGameplanMock,
  toggleGameplanCheck: toggleGameplanCheckMock,
}));

function runFixture(overrides: Partial<ApplicationGameplanRun> = {}): ApplicationGameplanRun {
  return {
    id: 'fictional-run-1',
    promptId: 'application-gameplan@v1',
    provider: 'anthropic',
    model: 'mock-sonnet',
    status: 'ok',
    attempt: 1,
    inputTokens: 14200,
    outputTokens: 480,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 6100,
    createdAt: '2026-07-28T10:00:00.000Z',
    ...overrides,
  };
}

function phaseFixture(
  phase: GameplanPhase,
  overrides: Partial<GameplanPhaseView> = {},
): GameplanPhaseView {
  return {
    phase,
    strategy: `Strategy for the ${phase} phase.`,
    checklist: GAMEPLAN_CHECKLIST_TEMPLATES.filter((template) => template.phase === phase).map(
      (template) => ({ key: template.key, phase, label: template.label, done: false }),
    ),
    stageEvents: [],
    ...overrides,
  };
}

function storyFixture(overrides: Partial<GameplanStoryWire> = {}): GameplanStoryWire {
  return {
    id: 'fictional-story-1',
    position: 0,
    situation: 'The billing service was a monthly batch job that missed SLAs.',
    task: 'Move it to an event-driven design without downtime.',
    action: 'Led a phased cutover with a dual-write bridge and shadow reads.',
    result: 'Cut settlement latency from hours to seconds across two quarters.',
    requirementId: 'fictional-req-1',
    requirementText: 'Experience designing event-driven systems',
    requirementKind: 'must_have',
    requirementCategory: 'framework',
    citations: [
      {
        evidenceLinkId: 'fictional-link-1',
        strength: 'direct',
        postingQuote: 'must have experience with event-driven architectures',
        profileQuote: 'Migrated billing to an event-driven architecture over two quarters.',
      },
    ],
    ...overrides,
  };
}

function gameplanFixture(overrides: Partial<ApplicationGameplan> = {}): ApplicationGameplan {
  return {
    id: 'fictional-gameplan-1',
    fitReportId: 'fictional-report-1',
    reviewStatus: 'draft',
    notes: null,
    createdAt: '2026-07-28T10:00:01.000Z',
    strategySummary: 'Lead with the billing migration - it is your strongest verified match.',
    phases: GAMEPLAN_PHASES.map((phase) => phaseFixture(phase)),
    stories: [storyFixture()],
    siblings: { improvementPlan: null, interviewPrep: null },
    ...overrides,
  };
}

function response(
  overrides: Partial<ApplicationGameplanResponse> = {},
): ApplicationGameplanResponse {
  return { run: null, gameplan: gameplanFixture(), cached: false, ...overrides };
}

function reportFixture(reviewStatus: 'draft' | 'reviewed' = 'reviewed'): FitReportResponse {
  return {
    id: 'fictional-report-1',
    postingId: 'fictional-posting-1',
    extractionRunId: 'fictional-extraction-run-1',
    reviewStatus,
    notes: null,
    createdAt: '2026-07-28T09:00:00.000Z',
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

// The component keys its useAsyncData on report.id; @nuxt/test-utils shares one
// Nuxt instance across the file, so a fixed key would bleed the first mount's
// data into later mounts (the resume-studio test varies its key prop for the
// same reason). Stamp a unique report id per mount to force a fresh fetch.
let mountSequence = 0;
async function mountSection(
  report: FitReportResponse = reportFixture(),
  trackedApplicationId: string | null = null,
) {
  mountSequence += 1;
  const keyedReport: FitReportResponse = { ...report, id: `fictional-report-${mountSequence}` };
  return mountSuspended(GameplanSection, {
    props: {
      postingId: `fictional-posting-${mountSequence}`,
      report: keyedReport,
      trackedApplicationId,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GameplanSection', () => {
  it('previews the drafting work with a skeleton while the paid call is in flight (M8-16)', async () => {
    getGameplanMock.mockResolvedValue({ run: null, gameplan: null, cached: false });
    // Hold the paid call open so drafting stays true and the skeleton renders.
    let resolveDraft: () => void = () => {};
    draftGameplanMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDraft = () => resolve();
      }),
    );
    const wrapper = await mountSection();

    expect(wrapper.find('[data-testid="gp-drafting-skeleton"]').exists()).toBe(false);
    await wrapper.find('[data-testid="gp-draft-button"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="gp-drafting-skeleton"]').exists()).toBe(true);

    resolveDraft();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="gp-drafting-skeleton"]').exists()).toBe(false),
    );
  });

  it('gates drafting on a reviewed report (no draft button on a draft report)', async () => {
    getGameplanMock.mockResolvedValue({ run: null, gameplan: null, cached: false });
    const wrapper = await mountSection(reportFixture('draft'));
    expect(wrapper.find('[data-testid="gp-review-gate"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="gp-draft-button"]').exists()).toBe(false);
  });

  it('drafts once from a reviewed report and refetches so the gameplan renders', async () => {
    getGameplanMock
      .mockResolvedValueOnce({ run: null, gameplan: null, cached: false })
      .mockResolvedValueOnce(response());
    draftGameplanMock.mockResolvedValue(response({ run: runFixture() }));
    const wrapper = await mountSection();

    const button = wrapper.find('[data-testid="gp-draft-button"]');
    expect(button.exists()).toBe(true);
    await button.trigger('click');
    await vi.waitFor(() => expect(draftGameplanMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="gp-strategy-summary"]').text()).toContain(
        'billing migration',
      ),
    );
    expect(getGameplanMock).toHaveBeenCalledTimes(2);
  });

  it('Apply view renders the overall summary and one strategy per phase in GAMEPLAN_PHASES order', async () => {
    getGameplanMock.mockResolvedValue(response());
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="gp-strategy-summary"]').text()).toContain(
      'billing migration',
    );
    const phases = wrapper.findAll('[data-testid="gp-phase-strategy"]');
    expect(phases).toHaveLength(GAMEPLAN_PHASES.length);
    // First phase heading is the mapped Apply label, not the raw enum member.
    expect(phases[0]!.find('.gp-phase-name').text()).toBe('Apply');
  });

  it('Speak view renders each STAR story with its requirement chips and folded citation quotes', async () => {
    getGameplanMock.mockResolvedValue(response());
    const wrapper = await mountSection();
    const story = wrapper.find('[data-testid="gp-story"]');
    expect(story.exists()).toBe(true);
    expect(wrapper.find('[data-testid="gp-requirement"]').text()).toContain('event-driven systems');
    expect(wrapper.find('[data-testid="gp-requirement"]').text()).toContain('must have');
    expect(wrapper.find('[data-testid="gp-story-situation"]').text()).toContain('missed SLAs');
    expect(wrapper.find('[data-testid="gp-story-result"]').text()).toContain('hours to seconds');
    expect(wrapper.find('[data-testid="gp-evidence-strength"]').text()).toBe('direct');
    expect(wrapper.find('[data-testid="gp-posting-quote"]').text()).toContain(
      'event-driven architectures',
    );
    expect(wrapper.find('[data-testid="gp-profile-quote"]').text()).toContain('two quarters');
  });

  it('Speak view shows an honest empty note when the gameplan has no stories', async () => {
    getGameplanMock.mockResolvedValue(response({ gameplan: gameplanFixture({ stories: [] }) }));
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="gp-story"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="gp-stories-empty"]').text()).toContain('No stories');
  });

  it('Process view renders the phase checklists and the application-stage timeline', async () => {
    getGameplanMock.mockResolvedValue(
      response({
        gameplan: gameplanFixture({
          phases: GAMEPLAN_PHASES.map((phase) =>
            phase === 'apply'
              ? phaseFixture(phase, {
                  stageEvents: [
                    { occurredOn: '2026-07-20', fromStage: 'considering', toStage: 'applied' },
                  ],
                })
              : phaseFixture(phase),
          ),
        }),
      }),
    );
    const wrapper = await mountSection();
    // All 11 template items render across the phase checklists.
    expect(wrapper.findAll('[data-testid="gp-check"]')).toHaveLength(
      GAMEPLAN_CHECKLIST_TEMPLATES.length,
    );
    const event = wrapper.find('[data-testid="gp-stage-event"]');
    expect(event.exists()).toBe(true);
    expect(event.text()).toContain('2026-07-20');
    expect(event.text()).toContain('applied');
  });

  it('Process view links the stage timeline to the tracked application when one exists', async () => {
    getGameplanMock.mockResolvedValue(response());
    const wrapper = await mountSection(reportFixture(), 'fictional-application-1');
    const link = wrapper.find('[data-testid="gp-application-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('/applications/fictional-application-1');
    expect(wrapper.find('[data-testid="gp-application-untracked"]').exists()).toBe(false);
  });

  it('Process view shows an untracked note (no link) when the posting has no application', async () => {
    getGameplanMock.mockResolvedValue(response());
    const wrapper = await mountSection(reportFixture(), null);
    expect(wrapper.find('[data-testid="gp-application-link"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="gp-application-untracked"]').text()).toContain(
      'Not tracking',
    );
  });

  it('toggling a checklist item posts the key + desired state and takes the server overlay as truth', async () => {
    getGameplanMock.mockResolvedValue(response());
    const firstKey = GAMEPLAN_CHECKLIST_TEMPLATES[0]!.key;
    const overlay = GAMEPLAN_CHECKLIST_TEMPLATES.map((template) => ({
      key: template.key,
      phase: template.phase,
      label: template.label,
      done: template.key === firstKey,
    }));
    toggleGameplanCheckMock.mockResolvedValue({ checklist: overlay });
    const wrapper = await mountSection();

    const input = wrapper.find('[data-testid="gp-check-input"]');
    expect((input.element as HTMLInputElement).checked).toBe(false);
    await input.trigger('change');
    await vi.waitFor(() =>
      expect(toggleGameplanCheckMock).toHaveBeenCalledWith('fictional-gameplan-1', {
        checkKey: firstKey,
        done: true,
      }),
    );
    // The UI reflects the server overlay, never a client-computed done.
    await vi.waitFor(() =>
      expect(
        (wrapper.find('[data-testid="gp-check-input"]').element as HTMLInputElement).checked,
      ).toBe(true),
    );
    // A toggle does not refetch the whole gameplan (the overlay IS the truth).
    expect(getGameplanMock).toHaveBeenCalledTimes(1);
  });

  it('switching views toggles which panel is hidden and which tab is selected', async () => {
    getGameplanMock.mockResolvedValue(response());
    const wrapper = await mountSection();
    // Apply is the default: its panel is visible, the others hidden.
    expect(wrapper.find('[data-testid="gp-panel-apply"]').attributes('hidden')).toBeUndefined();
    expect(wrapper.find('[data-testid="gp-panel-speak"]').attributes('hidden')).toBeDefined();

    await wrapper.find('[data-testid="gp-view-speak"]').trigger('click');
    expect(wrapper.find('[data-testid="gp-panel-speak"]').attributes('hidden')).toBeUndefined();
    expect(wrapper.find('[data-testid="gp-panel-apply"]').attributes('hidden')).toBeDefined();
    expect(wrapper.find('[data-testid="gp-view-speak"]').attributes('aria-selected')).toBe('true');
  });

  it('a draft gameplan shows the draft chip + review form; reviewing refetches', async () => {
    getGameplanMock.mockResolvedValue(response());
    reviewGameplanMock.mockResolvedValue({
      id: 'fictional-gameplan-1',
      reviewStatus: 'reviewed',
      notes: 'Honest and grounded.',
    });
    const wrapper = await mountSection();

    expect(wrapper.find('[data-testid="gp-draft-chip"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="gp-review-form"]').exists()).toBe(true);

    await wrapper.find('[data-testid="gp-review-notes"]').setValue('Honest and grounded.');
    await wrapper.find('[data-testid="gp-mark-reviewed"]').trigger('click');
    await vi.waitFor(() =>
      expect(reviewGameplanMock).toHaveBeenCalledWith('fictional-gameplan-1', {
        notes: 'Honest and grounded.',
      }),
    );
    expect(getGameplanMock).toHaveBeenCalledTimes(2);
  });

  it('a reviewed gameplan shows the reviewed chip and no review form', async () => {
    getGameplanMock.mockResolvedValue(
      response({ gameplan: gameplanFixture({ reviewStatus: 'reviewed' }) }),
    );
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="gp-reviewed-chip"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="gp-review-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="gp-reviewed"]').exists()).toBe(true);
  });

  it('renders meta-only sibling pointers (existing vs not drafted)', async () => {
    getGameplanMock.mockResolvedValue(
      response({
        gameplan: gameplanFixture({
          siblings: {
            improvementPlan: { id: 'fictional-plan-1', reviewStatus: 'reviewed' },
            interviewPrep: null,
          },
        }),
      }),
    );
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="gp-sibling-improvement-plan"]').text()).toContain(
      'reviewed',
    );
    expect(wrapper.find('[data-testid="gp-sibling-interview-prep"]').text()).toContain(
      'not drafted',
    );
  });

  it('a flagged draft persists nothing and shows the loud banner without dropping the draft button', async () => {
    getGameplanMock
      .mockResolvedValueOnce({ run: null, gameplan: null, cached: false })
      .mockResolvedValueOnce({
        run: runFixture({ status: 'flagged' }),
        gameplan: null,
        cached: false,
      });
    draftGameplanMock.mockResolvedValue({
      run: runFixture({ status: 'flagged' }),
      gameplan: null,
      cached: false,
    });
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="gp-draft-button"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="gp-failed-run"]').exists()).toBe(true),
    );
    const banner = wrapper.find('[data-testid="gp-failed-run"]');
    expect(banner.attributes('role')).toBe('alert');
    expect(banner.text()).toContain('flagged');
    expect(banner.text()).toContain('message to send');
    // A failed run does not hide the draft button - re-POST is the retry.
    expect(wrapper.find('[data-testid="gp-draft-button"]').exists()).toBe(true);
  });

  it('the phase display vocab is complete against GAMEPLAN_PHASES (no blank heading)', async () => {
    // Record<GameplanPhase, string> makes a missing key a typecheck error; this
    // runtime pin catches a blank/wrong VALUE that would still typecheck (the
    // skills-page LADDER precedent). Each phase heading must be non-empty.
    getGameplanMock.mockResolvedValue(response());
    const wrapper = await mountSection();
    const headings = wrapper.findAll('[data-testid="gp-phase-strategy"] .gp-phase-name');
    expect(headings).toHaveLength(GAMEPLAN_PHASES.length);
    for (const heading of headings) {
      expect(heading.text().trim().length).toBeGreaterThan(0);
    }
  });

  it('hostile strategy / story / quote / notes text renders inert (interpolation, not markup)', async () => {
    const xss = '<script>window.__gpPwned = true<' + '/script><img src=x onerror="x">';
    getGameplanMock.mockResolvedValue(
      response({
        gameplan: gameplanFixture({
          reviewStatus: 'draft',
          notes: xss,
          strategySummary: xss,
          stories: [
            storyFixture({
              situation: xss,
              requirementText: xss,
              citations: [
                {
                  evidenceLinkId: 'fictional-link-x',
                  strength: 'direct',
                  postingQuote: xss,
                  profileQuote: xss,
                },
              ],
            }),
          ],
        }),
      }),
    );
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="gameplan-section"] script').exists()).toBe(false);
    expect(wrapper.find('[data-testid="gameplan-section"] img').exists()).toBe(false);
    expect((globalThis as Record<string, unknown>).__gpPwned).toBeUndefined();
    expect(wrapper.find('[data-testid="gp-strategy-summary"]').text()).toContain('<script>');
  });
});
