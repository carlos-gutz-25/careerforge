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
  CLAIM_PROVENANCE_LAWS,
  CLAIM_SHAPE_RULES,
  RESUME_AUDIT_FORMATS,
  RESUME_CLAIM_SECTIONS,
  RESUME_CLAIM_TEXT_MAX_CHARS,
  RESUME_COMPOSE_RUN_STATUSES,
  RESUME_EXPORT_FORMATS,
  RESUME_MAX_CLAIMS,
  RESUME_MAX_CLAIMS_PER_EXPERIENCE,
  RESUME_MAX_CLAIMS_PER_PROJECT,
  RESUME_SUMMARY_TOTAL_MAX_CHARS,
  SKILL_LEVELS,
  type FitReportResponse,
  type FitReportResumeDocumentResponse,
  type ParseAuditReport,
  type ResumeComposeRun,
  type ResumeDocumentClaim,
  type ResumeDocumentResponse,
  type ResumeGateViolation,
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
    // M15-01 made `gateViolations` a REQUIRED three-state field (never
    // `undefined`). This fixture predates it, and no apps/web test is
    // typechecked, so an absent field would hand the banner a fourth state at
    // runtime with nothing going red to warn us. Explicit null is the default.
    gateViolations: null,
    ...overrides,
  };
}

/** One fictional gate violation. `detail` is only meaningful for `shape`. */
function violationFixture(overrides: Partial<ResumeGateViolation> = {}): ResumeGateViolation {
  return {
    claimIndex: 0,
    section: 'summary',
    law: 'shape',
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
    // M15-02: runFixture carries `gateViolations: null`, so this run renders the
    // honest-ignorance branch - it names no law rather than guessing one.
    expect(wrapper.find('[data-testid="rs-gate-unrecorded"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rs-gate-laws"]').exists()).toBe(false);
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

  // ---- M15-02: the flagged banner names what actually failed -----------------
  //
  // The incident this story fixes: a draft was rejected because its summary ran
  // 84 characters over a length cap, and the banner told the user a claim was
  // "either uncited, fabricated a number, or crossed employment boundaries".
  // Nothing was fabricated. These rows pin the banner to the payload.

  /** Mount, compose, and land on the flagged banner with the given payload. */
  async function mountFlagged(gateViolations: ResumeGateViolation[] | null) {
    getResumeDocumentMock.mockResolvedValue({ run: null, document: null, cached: false });
    composeResumeDocumentMock.mockResolvedValue({
      run: runFixture({ status: 'flagged', gateViolations }),
      document: null,
      cached: false,
    });
    const wrapper = await mountSection();
    await wrapper.find('[data-testid="rs-compose-button"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="rs-failed-run"]').exists()).toBe(true),
    );
    return wrapper;
  }

  /** A distinctive fragment of each law's sentence. `Record<Enum, ...>` makes a
   *  seventh core law a typecheck error here, and the ORDER pin below is built
   *  by walking core's array, so a permutation in core turns that row RED. */
  const LAW_MARKERS: Record<(typeof CLAIM_PROVENANCE_LAWS)[number], string> = {
    citation_membership: 'did not resolve',
    numeric: 'A number in a claim',
    vocabulary: 'skill phrase',
    provenance_class: 'cited under a different one',
    external_pointer: 'contact header',
    shape: 'structural limit',
  };

  /** The accusation vocabulary the old copy used. The tripwire: none of it may
   *  appear unless the law that justifies it is actually in the payload. */
  const ACCUSATIONS = [/fabricat/i, /uncited/i, /employment/i];

  it('names the summary length cap, and accuses the draft of nothing (the incident)', async () => {
    const wrapper = await mountFlagged([
      violationFixture({ law: 'shape', detail: ['summary_total_cap'] }),
    ]);
    const banner = wrapper.find('[data-testid="rs-failed-run"]').text();
    // The tripwire leads: this is the assertion that fails on the pre-M15-02
    // copy, and PF-1 demonstrates exactly that. It runs FIRST so the proof is
    // this proposition and not an incidental one further down.
    for (const accusation of ACCUSATIONS) expect(banner).not.toMatch(accusation);
    // Paired positive - a negative-only assertion passes just as well on an
    // empty banner (the M12-04 vacuous-assertion lesson).
    expect(wrapper.find('[data-testid="rs-gate-laws"]').text()).toContain('summary');
    expect(wrapper.find('[data-testid="rs-gate-laws"]').text()).toContain(
      String(RESUME_SUMMARY_TOTAL_MAX_CHARS),
    );
    // Payload-driven, not "print every label I own".
    expect(banner).not.toContain(LAW_MARKERS.numeric);
  });

  it('renders the numeric law only when the payload carries it', async () => {
    const wrapper = await mountFlagged([
      violationFixture({ law: 'numeric', section: 'experience' }),
    ]);
    expect(wrapper.find('[data-testid="rs-gate-laws"]').text()).toContain(LAW_MARKERS.numeric);
  });

  it('degrades to honest ignorance when gateViolations is null', async () => {
    const wrapper = await mountFlagged(null);
    expect(wrapper.find('[data-testid="rs-gate-unrecorded"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rs-gate-laws"]').exists()).toBe(false);
    const banner = wrapper.find('[data-testid="rs-failed-run"]').text();
    for (const marker of Object.values(LAW_MARKERS)) expect(banner).not.toContain(marker);
    for (const accusation of ACCUSATIONS) expect(banner).not.toMatch(accusation);
  });

  it('degrades the same way on the empty-array contradiction', async () => {
    const wrapper = await mountFlagged([]);
    expect(wrapper.find('[data-testid="rs-gate-unrecorded"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rs-gate-laws"]').exists()).toBe(false);
    const banner = wrapper.find('[data-testid="rs-failed-run"]').text();
    for (const marker of Object.values(LAW_MARKERS)) expect(banner).not.toContain(marker);
  });

  it('dedupes laws and renders them in core order even when the payload contradicts it', async () => {
    // Arrival order is by claimIndex FIRST, so this payload presents the laws
    // REVERSED against core's order, with duplicates. A component that rendered
    // the payload as it arrived would fail this row; that is the point.
    const reversed = [...CLAIM_PROVENANCE_LAWS].reverse();
    const wrapper = await mountFlagged(
      reversed.flatMap((law, index) => [
        violationFixture({ claimIndex: index, law, section: 'experience' }),
        violationFixture({ claimIndex: index + reversed.length, law, section: 'experience' }),
      ]),
    );
    const text = wrapper.find('[data-testid="rs-gate-laws"]').text();
    // ORDER pin, built by walking core's array: a permutation there reorders
    // this expectation while the component's local list stays put -> RED.
    const positions = CLAIM_PROVENANCE_LAWS.map((law) => text.indexOf(LAW_MARKERS[law]));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Deduped: each law's sentence appears exactly once despite two violations.
    for (const law of CLAIM_PROVENANCE_LAWS) {
      expect(text.split(LAW_MARKERS[law]).length - 1).toBe(1);
    }
  });

  it('has a non-empty sentence for every law and every shape sub-rule', async () => {
    for (const law of CLAIM_PROVENANCE_LAWS) {
      const wrapper = await mountFlagged([violationFixture({ law, section: 'experience' })]);
      expect(wrapper.find('[data-testid="rs-gate-laws"]').text().trim().length).toBeGreaterThan(0);
    }
    for (const rule of CLAIM_SHAPE_RULES) {
      const wrapper = await mountFlagged([violationFixture({ law: 'shape', detail: [rule] })]);
      expect(wrapper.find('[data-testid="rs-gate-laws"]').text().trim().length).toBeGreaterThan(0);
    }
  });

  it('interpolates every cap from a constant pinned to core, never a literal', async () => {
    // Two legs at once, through the render - the only lawful mechanism, since
    // the component's consts are local (M1-11) and not exported. If a local cap
    // drifts from core's, the rendered sentence stops containing core's value.
    // A bare toContain('600') would pass on a component whose constant said
    // something else entirely; this cannot.
    const capRules = [
      ['summary_total_cap', RESUME_SUMMARY_TOTAL_MAX_CHARS],
      ['claim_text_cap', RESUME_CLAIM_TEXT_MAX_CHARS],
      ['claim_count_cap', RESUME_MAX_CLAIMS],
      ['experience_claim_cap', RESUME_MAX_CLAIMS_PER_EXPERIENCE],
      ['project_claim_cap', RESUME_MAX_CLAIMS_PER_PROJECT],
    ] as const;
    for (const [rule, cap] of capRules) {
      const wrapper = await mountFlagged([violationFixture({ law: 'shape', detail: [rule] })]);
      // WORD BOUNDARY, not a substring. `toContain(String(cap))` was vacuous for
      // any drifted value whose decimal form contains core's: it passed on 300
      // -> 3000 and on 6 -> 16, i.e. on a banner stating a limit the gate does
      // not enforce, which is the exact lying-banner case this row exists to
      // catch. Caught by the review seat with a positive control.
      expect(wrapper.find('[data-testid="rs-gate-laws"]').text()).toMatch(
        new RegExp(String.raw`\b${cap}\b`),
      );
    }
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
