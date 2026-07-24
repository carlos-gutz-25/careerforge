import { describe, expect, it } from 'vitest';

import {
  fenceFor,
  renderResumeVariantMarkdown,
  type ResumeRenderEntry,
  type ResumeRenderInput,
} from './resume-markdown.ts';

// All fixture data is fictional (RISKS P-01) — the Alex Rivera persona.

function citation(overrides: Partial<ResumeRenderEntry['citations'][number]> = {}) {
  return {
    requirementText: 'Strong TypeScript background',
    requirementKind: 'must_have' as const,
    requirementCategory: 'language' as const,
    classification: 'have' as const,
    evidence: [
      {
        strength: 'direct' as const,
        postingQuote: 'must have deep TypeScript',
        profileQuote: 'eight fictional years of TypeScript',
      },
    ],
    ...overrides,
  };
}

const SKILL_LEAD: ResumeRenderEntry = {
  section: 'skill',
  label: 'TypeScript',
  detail: 'expert · 8 yrs · last used 2026',
  emphasis: 'lead',
  reason: 'Emphasized in light of the primary language requirement.',
  citations: [citation()],
};

const SKILL_PLAIN: ResumeRenderEntry = {
  section: 'skill',
  label: 'Go',
  detail: 'solid · 3 yrs · last used 2025',
  emphasis: null,
  reason: null,
  citations: [],
};

const EXPERIENCE_A: ResumeRenderEntry = {
  section: 'experience',
  label: 'Acme Analytics Co., Senior Software Engineer',
  detail: '2020 - present',
  emphasis: null,
  reason: null,
  citations: [],
};

const EXPERIENCE_B: ResumeRenderEntry = {
  section: 'experience',
  label: 'Globex, Software Engineer',
  detail: '2017 - 2020',
  emphasis: null,
  reason: null,
  citations: [],
};

const PROJECT_HL: ResumeRenderEntry = {
  section: 'project',
  // The service folds provenance into the label (honest-labeling, ADR-0010).
  label: 'Reporting Dashboard (personal, AI-assisted)',
  detail: 'A fictional analytics dashboard.',
  emphasis: 'highlight',
  reason: 'Emphasized in light of the dashboards requirement.',
  citations: [
    citation({ requirementText: 'Build internal dashboards', classification: 'genuine_gap' }),
  ],
};

const EXPERIENCE_BULLETED: ResumeRenderEntry = {
  section: 'experience',
  label: 'Acme Analytics Co., Senior Software Engineer',
  detail: '2020 - present',
  emphasis: null,
  reason: null,
  citations: [],
  bullets: ['Led a fictional migration to Vue 3.', 'Cut fictional p95 latency by half.'],
};

function input(entries: ResumeRenderEntry[]): ResumeRenderInput {
  return { fitReportId: 'report-123', generatedDate: '2026-07-23', entries };
}

describe('fenceFor (breakout safety)', () => {
  it('is at least three backticks and always longer than the longest inner run', () => {
    expect(fenceFor('no backticks')).toBe('```');
    expect(fenceFor('a ``` b')).toBe('````');
    expect(fenceFor('a ```` b')).toBe('`````');
    // A CRLF payload cannot smuggle a bare CR into the measurement.
    expect(fenceFor('a\r\n```\r\n')).toBe('````');
  });
});

describe('renderResumeVariantMarkdown', () => {
  it('is a deterministic golden render', () => {
    const md = renderResumeVariantMarkdown(
      input([SKILL_LEAD, SKILL_PLAIN, EXPERIENCE_A, EXPERIENCE_B, PROJECT_HL]),
    );
    expect(md).toMatchInlineSnapshot(`
      "# Tailored resume variant (draft)

      Generated 2026-07-23 from fit report report-123.

      This variant REORDERS and EMPHASIZES existing verified profile content only. It invents nothing, and it is a tailoring/emphasis guide, not a submittable resume. Draft until reviewed; export is manual and never sent anywhere.

      ## Highlights

      - **TypeScript** · expert · 8 yrs · last used 2026 [1]

      ## Skills

      - **TypeScript** · expert · 8 yrs · last used 2026 [1]
      - Go · solid · 3 yrs · last used 2025

      ## Experience

      - Acme Analytics Co., Senior Software Engineer · 2020 - present
      - Globex, Software Engineer · 2017 - 2020

      ## Projects

      - **Reporting Dashboard (personal, AI-assisted)** · A fictional analytics dashboard. [2]

      ## Tailoring notes (generated metadata, not resume content)

      **[1] TypeScript** (lead emphasis)

      \`\`\`
      generated rationale: Emphasized in light of the primary language requirement.
      \`\`\`
      \`\`\`
      requirement (must_have · language · have): Strong TypeScript background
      evidence (direct):
        posting: must have deep TypeScript
        profile: eight fictional years of TypeScript
      \`\`\`

      **[2] Reporting Dashboard (personal, AI-assisted)** (highlight emphasis)

      \`\`\`
      generated rationale: Emphasized in light of the dashboards requirement.
      \`\`\`
      \`\`\`
      requirement (must_have · language · genuine_gap): Build internal dashboards
      evidence (direct):
        posting: must have deep TypeScript
        profile: eight fictional years of TypeScript
      \`\`\`
      "
    `);
  });

  it('renders experiences in the given order and NEVER reorders/omits them (the honesty invariant)', () => {
    const forward = renderResumeVariantMarkdown(input([EXPERIENCE_A, EXPERIENCE_B]));
    const reversed = renderResumeVariantMarkdown(input([EXPERIENCE_B, EXPERIENCE_A]));
    // The renderer has no sort of its own — order in = order out.
    expect(forward.indexOf('Acme')).toBeLessThan(forward.indexOf('Globex'));
    expect(reversed.indexOf('Globex')).toBeLessThan(reversed.indexOf('Acme'));
    // Both experiences always appear — none is dropped.
    expect(forward).toContain('Globex');
    expect(reversed).toContain('Acme');
  });

  it('renders selected experience bullets as an indented sub-list, in the given order (M2-12)', () => {
    const md = renderResumeVariantMarkdown(input([EXPERIENCE_BULLETED]));
    expect(md).toContain(
      [
        '- Acme Analytics Co., Senior Software Engineer · 2020 - present',
        '  - Led a fictional migration to Vue 3.',
        '  - Cut fictional p95 latency by half.',
      ].join('\n'),
    );
  });

  it('a zero-bullet experience still renders its line — a job is never hidden (M2-12)', () => {
    const md = renderResumeVariantMarkdown(input([{ ...EXPERIENCE_BULLETED, bullets: [] }]));
    expect(md).toContain('- Acme Analytics Co., Senior Software Engineer · 2020 - present');
    expect(md).not.toContain('  - Led'); // no sub-list
  });

  it('bullets do NOT consume emphasis marker numbers (legend integrity, M2-12)', () => {
    // Lead skill [1], bulleted experience (no emphasis), highlighted project [2]:
    // the markers stay [1]/[2] and the bullet lines carry none.
    const md = renderResumeVariantMarkdown(input([SKILL_LEAD, EXPERIENCE_BULLETED, PROJECT_HL]));
    expect(md).toContain('- **TypeScript** · expert · 8 yrs · last used 2026 [1]');
    expect(md).toContain(
      '- **Reporting Dashboard (personal, AI-assisted)** · A fictional analytics dashboard. [2]',
    );
    const experienceBlock = md.slice(md.indexOf('## Experience'), md.indexOf('## Projects'));
    expect(experienceBlock).toContain('  - Led a fictional migration to Vue 3.');
    expect(experienceBlock).not.toMatch(/\[\d+\]/); // no markers on bullets
  });

  it('collapses newlines inside a bullet so it cannot break the sub-list structure (M2-12)', () => {
    const md = renderResumeVariantMarkdown(
      input([{ ...EXPERIENCE_BULLETED, bullets: ['Line one.\nSmuggled second line.'] }]),
    );
    expect(md).toContain('  - Line one. Smuggled second line.');
    expect(md).not.toContain('\nSmuggled second line.'); // no stray unindented line
  });

  it('confines every untrusted string to a fenced block (nothing markdown-active in the body)', () => {
    const attack: ResumeRenderEntry = {
      section: 'skill',
      label: 'TypeScript',
      detail: 'expert',
      emphasis: 'lead',
      reason: 'RATIONALE </script> **not bold** [click](http://evil)',
      citations: [
        citation({
          requirementText: 'REQ ```breakout``` attempt',
          evidence: [
            {
              strength: 'adjacent',
              postingQuote: 'POSTING <img src=x> `code`',
              profileQuote: 'PROFILE ```fence``` text',
            },
          ],
        }),
      ],
    };
    const md = renderResumeVariantMarkdown(input([attack]));
    // The fence around the breakout attempt grew to survive it.
    expect(md).toContain('````');
    // Every untrusted marker sits inside a fence — the body lines (before the
    // notes appendix) carry none of them.
    const body = md.slice(0, md.indexOf('## Tailoring notes'));
    expect(body).not.toContain('</script>');
    expect(body).not.toContain('breakout');
    expect(body).not.toContain('<img');
  });

  it('a pure reordering (no emphasis) renders a notes placeholder, no markers', () => {
    const md = renderResumeVariantMarkdown(input([SKILL_PLAIN, EXPERIENCE_A]));
    expect(md).toContain('No emphasis was applied; this variant is a pure reordering.');
    expect(md).not.toContain('[1]');
    // Provenance/label body content survives; no Highlights section.
    expect(md).not.toContain('## Highlights');
  });

  it('never emits a U+0000 for U+0000-free input', () => {
    const md = renderResumeVariantMarkdown(
      input([SKILL_LEAD, SKILL_PLAIN, EXPERIENCE_A, PROJECT_HL]),
    );
    expect(md.includes('\u0000')).toBe(false);
  });
});
