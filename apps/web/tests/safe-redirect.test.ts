// @vitest-environment node
// Pure utility — no Nuxt runtime needed.
import { describe, expect, it } from 'vitest';

import { safeRedirect } from '../app/utils/safe-redirect.ts';

describe('safeRedirect (M0-10 approval amendment: open-redirect defense)', () => {
  it('falls back to / for an absolute URL — the amendment pin', () => {
    expect(safeRedirect('https://evil.example/phish')).toBe('/');
  });

  it('falls back to / for protocol-relative and scheme-carrying targets', () => {
    expect(safeRedirect('//evil.example/phish')).toBe('/');
    expect(safeRedirect('javascript:alert(1)')).toBe('/');
    expect(safeRedirect('http://localhost:3000/looks-internal')).toBe('/');
  });

  it('falls back to / for non-string input (repeated ?redirect= params arrive as arrays)', () => {
    expect(safeRedirect(undefined)).toBe('/');
    expect(safeRedirect(null)).toBe('/');
    expect(safeRedirect(['/a', '/b'])).toBe('/');
  });

  it('honors internal paths, including query strings', () => {
    expect(safeRedirect('/')).toBe('/');
    expect(safeRedirect('/profile?tab=skills')).toBe('/profile?tab=skills');
  });
});
