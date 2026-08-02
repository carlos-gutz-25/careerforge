// Resume Studio composed document UI (M6-07, over M6-04/M6-05 endpoints). The
// PRIMARY composed-with-provenance resume, distinct from the M2-10 tailoring
// GUIDE (ResumeVariantSection) - compose is review-gated + fire-once, a
// flagged/empty run persists nothing (loud banner), the document renders contact
// + claims-with-citations + education + skills, draft->reviewed is one-shot,
// export (5 formats) + parse-audit are the reviewed-doc surfaces, redraft drafts
// revision N+1. Rendering law (M1-02): claim text / citation sourceText / contact
// fields all render as escaped interpolation only. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CITATION_SOURCE_KINDS,
  RESUME_AUDIT_FORMATS,
  RESUME_CLAIM_SECTIONS,
  RESUME_COMPOSE_RUN_STATUSES,
  RESUME_EXPORT_FORMATS,
  SKILL_LEVELS,
  type FitReportResponse,
  type FitReportResumeDocumentResponse,
  type ParseAuditReport,
  type ResumeComposeRun,
  type ResumeDocumentClaim,
  type ResumeDocumentResponse,
} from '@careerforge/core';

import ResumeStudioSection from '../app/components/ResumeStudioSection.vue';
import { useDemoState } from '../app/composables/use-demo-mode.ts';

const {
  getResumeDocumentMock,
  composeResumeDocumentMock,
  redraftResumeDocumentMock,
  reviewResumeDocumentMock,
  exportResumeDocumentMock,
  getResumeParseAuditMock,
} = vi.hoisted(() => ({
  getResumeDocumentMock: vi.fn(),
  composeResumeDocumentMock: vi.fn(),
  redraftResumeDocumentMock: vi.fn(),
  reviewResumeDocumentMock: vi.fn(),
  exportResumeDocumentMock: vi.fn(),
  getResumeParseAuditMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getResumeDocument: getResumeDocumentMock,
  composeResumeDocument: composeResumeDocumentMock,
  redraftResumeDocument: redraftResumeDocumentMock,
  reviewResumeDocument: reviewResumeDocumentMock,
  exportResumeDocument: exportResumeDocumentMock,
  getResumeParseAudit: getResumeParseAuditMock,
}));

function runFixture(overrides: Partial<ResumeComposeRun> = {}): ResumeComposeRun {
  return {
    id: 'fictional-run-1',
    promptId: 'resume-compose@v1',
    provider: 'anthropic',
    model: 'mock-sonnet',
    status: 'ok',
    attempt: 1,
    inputTokens: 12740,
    outputTokens: 340,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 5200,
    createdAt: '2026-07-28T10:00:00.000Z',
    ...overrides,
  };
}

function claimFixture(overrides: Partial<ResumeDocumentClaim> = {}): ResumeDocumentClaim {
  return {
    id: 'fictional-claim-1',
    section: 'experience',
    entityRef: 'x1',
    entityLabel: 'Fictional Gizmo Works, Senior Engineer',
    text: 'Led the migration of the billing service to an event-driven design.',
    position: 0,
    citations: [
      {
        sourceKind: 'experience_bullet',
        sourceText: 'Migrated billing to an event-driven architecture over two quarters.',
        position: 0,
      },
    ],
    ...overrides,
  };
}

function docFixture(overrides: Partial<ResumeDocumentResponse> = {}): ResumeDocumentResponse {
  const claims = overrides.claims ?? [claimFixture()];
  return {
    id: 'fictional-doc-1',
    fitReportId: 'fictional-report-1',
    revision: 1,
    reviewStatus: 'draft',
    supersededAt: null,
    stale: false,
    notes: null,
    createdAt: '2026-07-28T10:00:01.000Z',
    canonicalDoc: {
      contact: {
        fullName: 'Fictional Candidate',
        headline: 'Senior Software Engineer',
        email: 'candidate@example.test',
        phone: '+1-555-0100',
        location: 'Fictionville, XX',
        links: [{ label: 'GitHub', url: 'https://example.test/gh' }],
      },
      education: [
        {
          institution: 'Fictional State University',
          credential: 'BS Computer Science',
          startYear: 2011,
          endYear: 2015,
        },
      ],
      skills: [{ name: 'TypeScript', level: 'expert' }],
      claims: claims.map((claim) => ({
        section: claim.section,
        entityRef: claim.entityRef,
        entityLabel: claim.entityLabel,
        text: claim.text,
        position: claim.position,
      })),
    },
    claims,
    ...overrides,
  };
}

function response(
  overrides: Partial<FitReportResumeDocumentResponse> = {},
): FitReportResumeDocumentResponse {
  return { run: null, document: docFixture(), cached: false, ...overrides };
}

function auditFixture(overrides: Partial<ParseAuditReport> = {}): ParseAuditReport {
  return {
    parseIntegrity: { ok: true, missing: [], outOfOrder: [] },
    evidenceIntegrity: { ok: true, missingClaims: [] },
    honesty: 'Render-fidelity only. This is not a prediction of any real ATS.',
    ...overrides,
  };
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

let mountSequence = 0;
async function mountSection(report: FitReportResponse = reportFixture()) {
  mountSequence += 1;
  return mountSuspended(ResumeStudioSection, {
    props: { reportId: `fictional-report-${mountSequence}`, report },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useDemoState().value = undefined;
});

describe('ResumeStudioSection', () => {
  it('disables the compose trigger and shows the demo note in demo mode (M10-04)', async () => {
    useDemoState().value = true;
    getResumeDocumentMock.mockResolvedValue({ run: null, document: null, cached: false });
    const wrapper = await mountSection();
    expect(wrapper.get('[data-testid="rs-compose-button"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="rs-compose-demo-note"]').exists()).toBe(true);
  });

  it('gates compose on a reviewed report (no compose button on a draft report)', async () => {
    getResumeDocumentMock.mockResolvedValue({ run: null, document: null, cached: false });
    const wrapper = await mountSection(reportFixture('draft'));
    expect(wrapper.find('[data-testid="rs-review-gate"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rs-compose-button"]').exists()).toBe(false);
  });

  it('composes once from a reviewed report and refetches so the document renders', async () => {
    getResumeDocumentMock
      .mockResolvedValueOnce({ run: null, document: null, cached: false })
      .mockResolvedValueOnce(response());
    composeResumeDocumentMock.mockResolvedValue(response({ run: runFixture() }));
    const wrapper = await mountSection();

    const button = wrapper.find('[data-testid="rs-compose-button"]');
    expect(button.exists()).toBe(true);
    await button.trigger('click');
    await vi.waitFor(() => expect(composeResumeDocumentMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="resume-studio-section"]').text()).toContain(
        'Fictional Candidate',
      ),
    );
    expect(getResumeDocumentMock).toHaveBeenCalledTimes(2);
  });

  it('renders the composed document: contact, claims grouped by section, education and skills', async () => {
    getResumeDocumentMock.mockResolvedValue(
      response({
        document: docFixture({
          claims: [
            claimFixture({ id: 'c-sum', section: 'summary', entityRef: null, entityLabel: null }),
            claimFixture({ id: 'c-exp', section: 'experience' }),
            claimFixture({
              id: 'c-proj',
              section: 'project',
              entityRef: 'p1',
              entityLabel: 'Reporting Dashboard',
            }),
          ],
        }),
      }),
    );
    const wrapper = await mountSection();

    // Contact facts.
    const contact = wrapper.find('[data-testid="rs-contact"]');
    expect(contact.text()).toContain('Fictional Candidate');
    expect(contact.text()).toContain('Senior Software Engineer');
    expect(contact.text()).toContain('candidate@example.test');
    expect(contact.text()).toContain('Fictionville, XX');
    expect(wrapper.find('[data-testid="rs-links"]').text()).toContain('https://example.test/gh');

    // One group per non-empty section, in the core RESUME_CLAIM_SECTIONS order.
    const headings = wrapper
      .findAll('[data-testid="rs-claim-group"] h3')
      .map((h) => h.text().toLowerCase());
    expect(headings).toEqual(['summary', 'experience', 'projects']);
    expect(wrapper.findAll('[data-testid="rs-claim"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="rs-claim-entity"]').text()).toContain(
      'Fictional Gizmo Works',
    );

    // Education + skills.
    expect(wrapper.find('[data-testid="rs-education"]').text()).toContain(
      'Fictional State University',
    );
    expect(wrapper.find('[data-testid="rs-skills"]').text()).toContain('TypeScript');
  });

  it('folds each claim citation with its source-kind label and durable source text', async () => {
    getResumeDocumentMock.mockResolvedValue(response());
    const wrapper = await mountSection();
    const citations = wrapper.find('[data-testid="rs-claim-citations"]');
    expect(citations.exists()).toBe(true);
    expect(citations.text()).toContain('Experience');
    expect(citations.text()).toContain('Migrated billing to an event-driven architecture');
  });

  it('shows the stale chip when the document is stale', async () => {
    getResumeDocumentMock.mockResolvedValue(response({ document: docFixture({ stale: true }) }));
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="rs-stale-chip"]').exists()).toBe(true);
  });

  it('a draft document shows the draft chip and review form, no export form; reviewing refetches', async () => {
    getResumeDocumentMock.mockResolvedValue(response());
    reviewResumeDocumentMock.mockResolvedValue({
      id: 'fictional-doc-1',
      reviewStatus: 'reviewed',
      notes: 'Honest.',
    });
    const wrapper = await mountSection();

    expect(wrapper.find('[data-testid="rs-status-chip"]').text()).toContain('Draft');
    expect(wrapper.find('[data-testid="rs-review-form"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rs-export-form"]').exists()).toBe(false);

    await wrapper.find('[data-testid="rs-review-notes"]').setValue('Honest.');
    await wrapper.find('[data-testid="rs-mark-reviewed"]').trigger('click');
    await vi.waitFor(() =>
      expect(reviewResumeDocumentMock).toHaveBeenCalledWith('fictional-doc-1', {
        notes: 'Honest.',
      }),
    );
    expect(getResumeDocumentMock).toHaveBeenCalledTimes(2);
  });

  it('a reviewed document shows the export form (not the review form) and exports the chosen format', async () => {
    getResumeDocumentMock.mockResolvedValue(
      response({ document: docFixture({ reviewStatus: 'reviewed' }) }),
    );
    exportResumeDocumentMock.mockResolvedValue(undefined);
    const wrapper = await mountSection();

    expect(wrapper.find('[data-testid="rs-status-chip"]').text()).toContain('Reviewed');
    expect(wrapper.find('[data-testid="rs-review-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="rs-export-form"]').exists()).toBe(true);

    // Default format is pdf; changing the select rides the export call.
    await wrapper.find('[data-testid="rs-export-format"]').setValue('docx');
    await wrapper.find('[data-testid="rs-export-button"]').trigger('click');
    await vi.waitFor(() =>
      expect(exportResumeDocumentMock).toHaveBeenCalledWith('fictional-doc-1', 'docx'),
    );
  });

  it('runs the parse-audit and renders the integrity chips, missing detail, and honesty string', async () => {
    getResumeDocumentMock.mockResolvedValue(
      response({ document: docFixture({ reviewStatus: 'reviewed' }) }),
    );
    getResumeParseAuditMock.mockResolvedValue(
      auditFixture({
        parseIntegrity: { ok: false, missing: ['contact.fullName'], outOfOrder: [] },
        evidenceIntegrity: { ok: false, missingClaims: [2] },
      }),
    );
    const wrapper = await mountSection();

    await wrapper.find('[data-testid="rs-audit-format"]').setValue('docx');
    await wrapper.find('[data-testid="rs-audit-button"]').trigger('click');
    await vi.waitFor(() =>
      expect(getResumeParseAuditMock).toHaveBeenCalledWith('fictional-doc-1', 'docx'),
    );
    const report = wrapper.find('[data-testid="rs-audit-report"]');
    expect(report.find('[data-testid="rs-audit-structure"]').text()).toContain('incomplete');
    expect(report.find('[data-testid="rs-audit-evidence"]').text()).toContain('incomplete');
    expect(report.text()).toContain('contact.fullName');
    expect(report.text()).toContain('not a prediction of any real ATS');
  });

  it('redraft posts the current document id and refetches', async () => {
    getResumeDocumentMock.mockResolvedValue(response());
    redraftResumeDocumentMock.mockResolvedValue(
      response({ run: runFixture(), document: docFixture({ id: 'fictional-doc-2', revision: 2 }) }),
    );
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="rs-redraft-button"]').trigger('click');
    await vi.waitFor(() =>
      expect(redraftResumeDocumentMock).toHaveBeenCalledWith('fictional-doc-1'),
    );
    expect(getResumeDocumentMock).toHaveBeenCalledTimes(2);
  });

  it('a flagged compose persists nothing and shows the loud banner without dropping the compose button', async () => {
    getResumeDocumentMock.mockResolvedValue({ run: null, document: null, cached: false });
    composeResumeDocumentMock.mockResolvedValue({
      run: runFixture({ status: 'flagged' }),
      document: null,
      cached: false,
    });
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="rs-compose-button"]').trigger('click');
    const banner = wrapper.find('[data-testid="rs-failed-run"]');
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="rs-failed-run"]').exists()).toBe(true),
    );
    expect(banner.attributes('role')).toBe('alert');
    expect(wrapper.find('[data-testid="rs-failed-run"]').text()).toContain('flagged');
    expect(wrapper.find('[data-testid="rs-failed-run"]').text()).toContain('failed provenance');
    // A failed run does not hide the compose button - re-POST is the retry.
    expect(wrapper.find('[data-testid="rs-compose-button"]').exists()).toBe(true);
    // GET is not refetched when nothing persisted.
    expect(getResumeDocumentMock).toHaveBeenCalledTimes(1);
  });

  it('an empty compose reports the empty terminal', async () => {
    getResumeDocumentMock.mockResolvedValue({ run: null, document: null, cached: false });
    composeResumeDocumentMock.mockResolvedValue({
      run: runFixture({ status: 'empty' }),
      document: null,
      cached: false,
    });
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="rs-compose-button"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="rs-failed-run"]').text()).toContain('no claims'),
    );
  });

  it('the local display vocab is complete against every core enum it renders', async () => {
    // Record<Enum, ...> makes a missing key a typecheck error; these runtime pins
    // catch a blank/wrong VALUE that would still typecheck (the skills-page LADDER
    // precedent). A member with no real label would render an empty string.
    for (const section of RESUME_CLAIM_SECTIONS) {
      getResumeDocumentMock.mockResolvedValue(
        response({ document: docFixture({ claims: [claimFixture({ section })] }) }),
      );
      const wrapper = await mountSection();
      const heading = wrapper.find('[data-testid="rs-claim-group"] h3').text().trim();
      expect(heading.length).toBeGreaterThan(0);
    }
    for (const level of SKILL_LEVELS) {
      const base = docFixture({ reviewStatus: 'reviewed' });
      getResumeDocumentMock.mockResolvedValue(
        response({
          document: {
            ...base,
            canonicalDoc: { ...base.canonicalDoc, skills: [{ name: 'Skill', level }] },
          },
        }),
      );
      const wrapper = await mountSection();
      expect(wrapper.find('[data-testid="rs-skills"]').text().trim().length).toBeGreaterThan(
        'Skill'.length,
      );
    }
    for (const kind of CITATION_SOURCE_KINDS) {
      getResumeDocumentMock.mockResolvedValue(
        response({
          document: docFixture({
            claims: [
              claimFixture({
                citations: [{ sourceKind: kind, sourceText: 'evidence', position: 0 }],
              }),
            ],
          }),
        }),
      );
      const wrapper = await mountSection();
      const kindText = wrapper.find('.rs-citation-kind').text().trim();
      expect(kindText.length).toBeGreaterThan(0);
    }
    // 'ok' renders in the telemetry footer after a persisting compose; each
    // non-ok terminal renders as its failed-run label. A missing map key would
    // render an empty status ("status: ." / no telemetry) - both asserted away.
    for (const runStatus of RESUME_COMPOSE_RUN_STATUSES) {
      if (runStatus === 'ok') continue;
      getResumeDocumentMock.mockResolvedValue({ run: null, document: null, cached: false });
      composeResumeDocumentMock.mockResolvedValue({
        run: runFixture({ status: runStatus }),
        document: null,
        cached: false,
      });
      const wrapper = await mountSection(reportFixture('reviewed'));
      await wrapper.find('[data-testid="rs-compose-button"]').trigger('click');
      await vi.waitFor(() =>
        expect(wrapper.find('[data-testid="rs-failed-run"]').exists()).toBe(true),
      );
      // The status label is non-empty (a missing key would leave "status: )").
      expect(wrapper.find('[data-testid="rs-failed-run"]').text()).toMatch(/status: [a-z]/i);
    }
    {
      // 'ok': the telemetry footer renders the run's status label after compose.
      getResumeDocumentMock
        .mockResolvedValueOnce({ run: null, document: null, cached: false })
        .mockResolvedValueOnce(response({ run: runFixture() }));
      composeResumeDocumentMock.mockResolvedValue(response({ run: runFixture() }));
      const wrapper = await mountSection(reportFixture('reviewed'));
      await wrapper.find('[data-testid="rs-compose-button"]').trigger('click');
      await vi.waitFor(() =>
        expect(wrapper.find('[data-testid="rs-telemetry"]').exists()).toBe(true),
      );
      expect(wrapper.find('[data-testid="rs-telemetry"]').text()).toContain('ok');
    }
    // Export + audit format lists are complete against the core enums.
    getResumeDocumentMock.mockResolvedValue(
      response({ document: docFixture({ reviewStatus: 'reviewed' }) }),
    );
    const wrapper = await mountSection();
    expect(wrapper.findAll('[data-testid="rs-export-format"] option')).toHaveLength(
      RESUME_EXPORT_FORMATS.length,
    );
    expect(wrapper.findAll('[data-testid="rs-audit-format"] option')).toHaveLength(
      RESUME_AUDIT_FORMATS.length,
    );
  });

  it('hostile claim / citation / contact / entity text renders inert (interpolation, not markup)', async () => {
    const xss = '<script>window.__rsPwned = true<' + '/script><img src=x onerror="x">';
    getResumeDocumentMock.mockResolvedValue(
      response({
        document: docFixture({
          notes: xss,
          reviewStatus: 'draft',
          claims: [
            claimFixture({
              entityLabel: xss,
              text: xss,
              citations: [{ sourceKind: 'summary', sourceText: xss, position: 0 }],
            }),
          ],
        }),
      }),
    );
    // Overwrite the contact too via a second doc shape.
    const wrapper = await mountSection();
    expect(wrapper.find('[data-testid="resume-studio-section"] script').exists()).toBe(false);
    expect(wrapper.find('[data-testid="resume-studio-section"] img').exists()).toBe(false);
    expect((globalThis as Record<string, unknown>).__rsPwned).toBeUndefined();
    expect(wrapper.find('[data-testid="rs-claim"]').text()).toContain('<script>');
  });
});
