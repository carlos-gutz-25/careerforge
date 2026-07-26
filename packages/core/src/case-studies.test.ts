import { describe, expect, it } from 'vitest';

import { renderCaseStudyDraftMarkdown, type CaseStudyDraftInput } from './case-study-markdown.ts';
import { CASE_STUDY_TITLE_MAX_CHARS, createCaseStudyBodySchema } from './case-studies.ts';

// M4-01 core — wire contracts + the deterministic renderer. All values
// fictional (Alex Rivera conventions). The renderer output MUST satisfy the
// portfolio honesty grammar (ADR-0010); the born-valid test (apps/api) proves
// that against the real validator CLI. These tests assert the structural
// invariants the renderer guarantees by construction.

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('createCaseStudyBodySchema (wire input)', () => {
  it('accepts a minimal body (title omitted — defaults to exercise title server-side)', () => {
    const parsed = createCaseStudyBodySchema.parse({
      exerciseId: VALID_UUID,
      provenance: 'personal',
    });
    expect(parsed).toEqual({ exerciseId: VALID_UUID, provenance: 'personal' });
  });

  it('accepts an explicit personal_ai_assisted provenance and a custom title', () => {
    const parsed = createCaseStudyBodySchema.parse({
      exerciseId: VALID_UUID,
      provenance: 'personal_ai_assisted',
      title: '  Rate limiter kata  ',
    });
    // z.string().trim() runs before max — the stored title is trimmed.
    expect(parsed.title).toBe('Rate limiter kata');
    expect(parsed.provenance).toBe('personal_ai_assisted');
  });

  it('REJECTS professional provenance at the wire (OD-3 — personal subset only)', () => {
    const result = createCaseStudyBodySchema.safeParse({
      exerciseId: VALID_UUID,
      provenance: 'professional',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown extra key (strictObject)', () => {
    const result = createCaseStudyBodySchema.safeParse({
      exerciseId: VALID_UUID,
      provenance: 'personal',
      status: 'published',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid exerciseId', () => {
    const result = createCaseStudyBodySchema.safeParse({
      exerciseId: 'not-a-uuid',
      provenance: 'personal',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty / whitespace-only title (min after trim)', () => {
    expect(
      createCaseStudyBodySchema.safeParse({
        exerciseId: VALID_UUID,
        provenance: 'personal',
        title: '   ',
      }).success,
    ).toBe(false);
  });

  it('rejects a title over the max length', () => {
    const result = createCaseStudyBodySchema.safeParse({
      exerciseId: VALID_UUID,
      provenance: 'personal',
      title: 'x'.repeat(CASE_STUDY_TITLE_MAX_CHARS + 1),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a title exactly at the max length', () => {
    const result = createCaseStudyBodySchema.safeParse({
      exerciseId: VALID_UUID,
      provenance: 'personal',
      title: 'x'.repeat(CASE_STUDY_TITLE_MAX_CHARS),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a title containing a U+0000 (NUL guard, value-free 400)', () => {
    const result = createCaseStudyBodySchema.safeParse({
      exerciseId: VALID_UUID,
      provenance: 'personal',
      title: `bad\u0000title`,
    });
    expect(result.success).toBe(false);
  });
});

// ── Renderer ─────────────────────────────────────────────────────────────────

const BASE_INPUT: CaseStudyDraftInput = {
  title: 'Rate limiter kata',
  provenance: 'personal',
  exerciseTitle: 'Token-bucket rate limiter',
  exerciseKind: 'kata',
  completedOn: '2026-05-14',
  evidence: [
    { kind: 'implemented', artifactUrl: 'https://example.test/pr/7', recordedOn: '2026-05-12' },
    { kind: 'tested', artifactUrl: null, recordedOn: '2026-05-13' },
  ],
  linkedGapCount: 2,
};

const CANONICAL_H2 = [
  'Problem',
  'Constraints',
  'Architecture',
  'Tradeoffs',
  'Testing',
  'Results',
  "What I'd Change",
];

function h2Headings(md: string): string[] {
  return md
    .split('\n')
    .filter((l) => /^## /.test(l))
    .map((l) => l.slice(3).trim());
}

/** The raw body lines of the Results section (between its ## and the next ##). */
function resultsSection(md: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Results');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

describe('renderCaseStudyDraftMarkdown', () => {
  it('emits exactly the seven canonical sections in order', () => {
    expect(h2Headings(renderCaseStudyDraftMarkdown(BASE_INPUT))).toEqual(CANONICAL_H2);
  });

  it('emits a four-line flat frontmatter with date == completedOn', () => {
    const md = renderCaseStudyDraftMarkdown(BASE_INPUT);
    const lines = md.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('title: "Rate limiter kata"');
    expect(lines[3]).toBe('date: 2026-05-14');
    expect(lines[4]).toBe('provenance: personal');
    expect(lines[5]).toBe('---');
  });

  it('has no body h1 (no line starts with a single #)', () => {
    const md = renderCaseStudyDraftMarkdown(BASE_INPUT);
    expect(md.split('\n').some((l) => /^# /.test(l))).toBe(false);
  });

  it('has no body prose provenance: line (R5 — provenance lives in frontmatter)', () => {
    const md = renderCaseStudyDraftMarkdown(BASE_INPUT);
    // Only the single frontmatter provenance line may match the anchor.
    const bodyStart = md.split('\n').indexOf('---', 1) + 1;
    const body = md.split('\n').slice(bodyStart);
    expect(body.some((l) => /^\s*(\*\*)?provenance:/i.test(l))).toBe(false);
  });

  it('lists evidence rows in Testing in the given order; null artifactUrl gets the fixed phrase', () => {
    const md = renderCaseStudyDraftMarkdown(BASE_INPUT);
    const implIdx = md.indexOf('- implemented (2026-05-12): https://example.test/pr/7');
    const testedIdx = md.indexOf('- tested (2026-05-13): no artifact URL recorded');
    expect(implIdx).toBeGreaterThan(-1);
    expect(testedIdx).toBeGreaterThan(implIdx);
  });

  it('states the linked-gap COUNT in Problem, never requirement text', () => {
    const md = renderCaseStudyDraftMarkdown({ ...BASE_INPUT, linkedGapCount: 3 });
    expect(md).toContain('addressed 3 linked learning gap(s)');
  });

  it('Results section carries no digit and no citation `[` span (R8-clean, CI shallow-safe)', () => {
    const results = resultsSection(renderCaseStudyDraftMarkdown(BASE_INPUT));
    expect(/\d/.test(results)).toBe(false);
    expect(results.includes('[')).toBe(false);
  });

  it('is byte-deterministic (identical input -> identical output)', () => {
    expect(renderCaseStudyDraftMarkdown(BASE_INPUT)).toBe(renderCaseStudyDraftMarkdown(BASE_INPUT));
  });

  it('emits printable-ASCII-only output for ASCII input', () => {
    const md = renderCaseStudyDraftMarkdown(BASE_INPUT);
    expect(/^[\x20-\x7E\n]*$/.test(md)).toBe(true);
  });

  it('ends with exactly one trailing newline', () => {
    const md = renderCaseStudyDraftMarkdown(BASE_INPUT);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('renders the Testing section non-empty even with zero evidence (R7 defensive)', () => {
    const md = renderCaseStudyDraftMarkdown({ ...BASE_INPUT, evidence: [] });
    expect(md).toContain('Recorded mastery evidence:');
    // Still exactly seven sections.
    expect(h2Headings(md)).toEqual(CANONICAL_H2);
  });
});

// ── Injection matrix (the load-bearing interior-newline collapse) ────────────

describe('renderCaseStudyDraftMarkdown — injection resistance', () => {
  const hostile = [
    '## Evil',
    '# h1',
    '---',
    'provenance: professional',
    '```',
    '"quotes"',
    'a: b: c',
    'line1\n## Evil',
    'line1\r\n## Evil',
    'x'.repeat(CASE_STUDY_TITLE_MAX_CHARS),
    'digits 12345',
  ];

  for (const payload of hostile) {
    it(`keeps structural invariants for hostile payload ${JSON.stringify(payload)}`, () => {
      const md = renderCaseStudyDraftMarkdown({
        ...BASE_INPUT,
        title: payload,
        exerciseTitle: payload,
        evidence: [{ kind: 'implemented', artifactUrl: payload, recordedOn: '2026-05-12' }],
      });
      // Exactly seven canonical `##` — a payload cannot mint an eighth.
      expect(h2Headings(md)).toEqual(CANONICAL_H2);
      // No body h1 injected.
      expect(md.split('\n').some((l) => /^# /.test(l))).toBe(false);
      // No `---` line inside the body (only the two frontmatter fences).
      expect(md.split('\n').filter((l) => l.trim() === '---')).toHaveLength(2);
      // No body prose provenance: line beyond the frontmatter one.
      const bodyStart = md.split('\n').indexOf('---', 1) + 1;
      expect(
        md
          .split('\n')
          .slice(bodyStart)
          .some((l) => /^\s*(\*\*)?provenance:/i.test(l)),
      ).toBe(false);
      // Results stays digit-free and citation-free regardless of payload (the
      // hostile digits land in Problem/Testing, outside R8's reach).
      const results = resultsSection(md);
      expect(/\d/.test(results)).toBe(false);
      expect(results.includes('[')).toBe(false);
    });
  }

  it('collapses a frontmatter title with an embedded quote to a single-quoted flat scalar', () => {
    const md = renderCaseStudyDraftMarkdown({ ...BASE_INPUT, title: 'He said "hi"\nand left' });
    expect(md.split('\n')[1]).toBe(`title: "He said 'hi' and left"`);
  });
});
