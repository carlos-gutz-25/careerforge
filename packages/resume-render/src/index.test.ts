import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { INTERNAL_DEPENDENCIES, MODULE_ID } from './index.ts';

describe('@careerforge/resume-render module wall (D1a)', () => {
  it('identifies itself', () => {
    expect(MODULE_ID).toBe('@careerforge/resume-render');
  });

  it('consumes @careerforge/core as its only internal dependency', () => {
    expect(INTERNAL_DEPENDENCIES).toEqual(['@careerforge/core']);
  });

  it('the @careerforge/* SUBSET of dependencies is EXACTLY @careerforge/core (external libs allowed)', () => {
    // Unlike packages/scoring (which asserts ALL keys equal ['@careerforge/core']),
    // resume-render has legitimate EXTERNAL render/parse deps - so the wall is on
    // the @careerforge/* SUBSET only. A new INTERNAL dependency cannot even be
    // declared without failing here; the D1b eslint block blocks the imports.
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const deps = manifest.dependencies ?? {};
    const internal = Object.keys(deps).filter((key) => key.startsWith('@careerforge/'));
    expect(internal).toEqual(['@careerforge/core']);
    // The external render/parse libs ARE expected as direct deps (not a wall breach).
    expect(Object.keys(deps)).toEqual(
      expect.arrayContaining(['pdfmake', 'docx', 'pdf-parse', 'mammoth']),
    );
  });
});
