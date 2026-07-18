import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { INTERNAL_DEPENDENCIES, MODULE_ID } from './index.js';

describe('@careerforge/scoring', () => {
  it('identifies itself', () => {
    expect(MODULE_ID).toBe('@careerforge/scoring');
  });

  it('consumes @careerforge/core as TS source across the workspace boundary', () => {
    expect(INTERNAL_DEPENDENCIES).toEqual(['@careerforge/core']);
  });

  it('runtime dependency manifest is EXACTLY @careerforge/core (purity, D2)', () => {
    // The lint wall blocks imports; this pins the manifest itself, so a new
    // runtime dependency cannot even be declared without failing a test.
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@careerforge/core']);
    // fast-check is dev-only by decision D2.
    expect(Object.keys(manifest.devDependencies ?? {})).toContain('fast-check');
  });
});
