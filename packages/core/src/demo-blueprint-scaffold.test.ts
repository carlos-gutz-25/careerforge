import { describe, expect, it } from 'vitest';

import {
  DEMO_BLUEPRINT_HONESTY,
  DEMO_BLUEPRINT_TITLE_MAX_CHARS,
  scaffoldDemoBlueprint,
  type DemoBlueprintScaffoldInput,
} from './demo-blueprint-scaffold.ts';

// M9-04: the deterministic scaffolder (D3). The load-bearing laws pinned here:
// the `problem` byte-pin (also the template-purity neuter's catch - interpolating
// requirement text into `problem` breaks this exact match), the numeric law (the
// only digit-runs are the interpolated counts), determinism, the categories
// clause, the ASCII/URL-free scan, and the honesty byte-pin. The
// no-posting-text-in-stored-sections wall against REAL adversarial requirement
// text is pinned end-to-end at the route layer (requirement text is not an input
// here, so it cannot be leaked from here by construction).

const SAMPLE: DemoBlueprintScaffoldInput = {
  postingCount: 7,
  instanceCount: 12,
  mustHavePostingCount: 3,
  niceToHavePostingCount: 4,
  categories: ['framework', 'language'],
};

const EXPECTED_PROBLEM =
  'Define, in your own words, the capability this build should demonstrate. This skill recurs ' +
  'across your own saved postings: it appears in 7 of them (3 as a must-have, 4 as a preferred ' +
  'or nice-to-have), with 12 total requirement mentions spanning the framework, language area(s). ' +
  'Do not copy any posting wording into this brief; the exact requirement text is shown to you ' +
  'separately, as reference only. State the problem as a concrete, buildable goal you can point ' +
  'at later.';

describe('scaffoldDemoBlueprint (M9-04, D3)', () => {
  it('byte-pins the `problem` section for a known input (template-purity anchor)', () => {
    // If the scaffolder ever interpolated requirement text into `problem` (the
    // template-purity neuter), this exact match would break.
    expect(scaffoldDemoBlueprint(SAMPLE).problem).toBe(EXPECTED_PROBLEM);
  });

  it('the only digits in the sections are the interpolated counts (numeric law)', () => {
    const sections = scaffoldDemoBlueprint(SAMPLE);
    const joined = [
      sections.problem,
      sections.constraints,
      sections.deliverables,
      sections.evidenceRequired,
    ].join('\n');
    // Digit-runs, in textual order: postingCount, mustHave, niceToHave, instanceCount.
    expect(joined.match(/\d+/g)).toEqual(['7', '3', '4', '12']);
  });

  it('is deterministic: identical input yields identical bytes', () => {
    expect(scaffoldDemoBlueprint(SAMPLE)).toEqual(scaffoldDemoBlueprint(SAMPLE));
  });

  it('emits the categories clause only when categories are present', () => {
    const withCats = scaffoldDemoBlueprint(SAMPLE).problem;
    expect(withCats).toContain('spanning the framework, language area(s)');
    const noCats = scaffoldDemoBlueprint({ ...SAMPLE, categories: [] }).problem;
    expect(noCats).not.toContain('spanning the');
    // Still ends cleanly with the mentions clause + a period.
    expect(noCats).toContain('total requirement mentions. Do not copy');
  });

  it('every section is printable ASCII, em-dash-free, and carries no external pointer', () => {
    const sections = scaffoldDemoBlueprint({ ...SAMPLE, categories: ['language'] });
    const texts = [
      sections.problem,
      sections.constraints,
      sections.deliverables,
      sections.evidenceRequired,
    ];
    for (const text of texts) {
      // Printable ASCII only (source-byte law extended to emitted content); this
      // also rejects the em-dash (U+2014) and every other non-ASCII codepoint.
      // eslint-disable-next-line no-control-regex
      expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
      expect(text.toLowerCase()).not.toContain('http');
      expect(text.toLowerCase()).not.toContain('www.');
      expect(text).not.toContain('@');
    }
  });

  it('pins DEMO_BLUEPRINT_HONESTY byte-exact and digit-free, and the title bound', () => {
    expect(DEMO_BLUEPRINT_HONESTY).toBe(
      'Template scaffolding over deterministic counts from your own saved postings. It instructs; ' +
        'it never asserts that you have experience or that a demo will close a gap. The exact ' +
        'requirement text is shown separately as reference, not built into these sections. This ' +
        'snapshot is as of when it was generated and deliberately outlives the postings behind it; ' +
        'refresh it or delete it to move on. Nothing here is advice or a claim about you.',
    );
    expect(DEMO_BLUEPRINT_HONESTY).not.toMatch(/\d/);
    expect(DEMO_BLUEPRINT_TITLE_MAX_CHARS).toBe(200);
  });
});
