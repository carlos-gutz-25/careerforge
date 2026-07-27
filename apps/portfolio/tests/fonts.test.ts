// @vitest-environment node
//
// M8-03 wiring gate -- pure text-parse (mirrors tokens-contrast.test.ts): reads
// fonts.css and nuxt.config.ts AS TEXT and stats the shipped woff2. It asserts
// the self-hosted Fraunces face, its metric-adjusted fallback, the preload link,
// and the font binary are wired correctly. No DOM/Nuxt dependency -> `node` env
// (import.meta.url is a file: URL here; happy-dom breaks fileURLToPath).
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const fontsCss = readFileSync(
  fileURLToPath(new URL('../app/assets/css/fonts.css', import.meta.url)),
  'utf8',
);
const nuxtConfig = readFileSync(
  fileURLToPath(new URL('../nuxt.config.ts', import.meta.url)),
  'utf8',
);
const woff2Path = fileURLToPath(
  new URL('../public/fonts/Fraunces-latin-var.woff2', import.meta.url),
);

// Lines trimmed of leading/trailing whitespace -- used for EXACT-string matches
// so a substring can't satisfy the wrong assertion (ADVISORY-A: 'Fraunces' is a
// substring of 'Fraunces Fallback').
const lines = fontsCss.split('\n').map((l) => l.trim());
const countExact = (s: string) => lines.filter((l) => l === s).length;

describe('M8-03 Fraunces self-hosting -- fonts.css', () => {
  it('declares exactly one real Fraunces @font-face (exact quoted family)', () => {
    // Match the FULL quoted token incl. closing quote + semicolon, not a
    // substring -- 'Fraunces Fallback' also contains "Fraunces".
    expect(countExact("font-family: 'Fraunces';")).toBe(1);
  });

  it('declares the variable weight range 100 900 (never weight-unset -> avoids the 900-black hazard)', () => {
    expect(fontsCss).toMatch(/font-weight:\s*100 900;/);
  });

  it('uses font-display: optional (abort-ramp step 1: no swap period -> no late LCP repaint)', () => {
    expect(fontsCss).toMatch(/font-display:\s*optional;/);
  });

  it('src references the self-hosted woff2 subset', () => {
    expect(fontsCss).toMatch(
      /src:\s*url\('\/fonts\/Fraunces-latin-var\.woff2'\)\s*format\('woff2'\);/,
    );
  });

  it('declares a distinct metric-adjusted fallback face with all four overrides as percentages', () => {
    expect(countExact("font-family: 'Fraunces Fallback';")).toBe(1);
    expect(fontsCss).toMatch(/size-adjust:\s*[\d.]+%;/);
    expect(fontsCss).toMatch(/ascent-override:\s*[\d.]+%;/);
    expect(fontsCss).toMatch(/descent-override:\s*[\d.]+%;/);
    expect(fontsCss).toMatch(/line-gap-override:\s*[\d.]+%;/);
  });
});

describe('M8-03 Fraunces self-hosting -- preload wiring (nuxt.config.ts)', () => {
  it('preloads the woff2 as a font with a crossorigin attribute', () => {
    // crossorigin is required even same-origin, else the preload double-fetches.
    expect(nuxtConfig).toMatch(/rel:\s*'preload'/);
    expect(nuxtConfig).toMatch(/as:\s*'font'/);
    expect(nuxtConfig).toMatch(/href:\s*'\/fonts\/Fraunces-latin-var\.woff2'/);
    expect(nuxtConfig).toMatch(/crossorigin:/);
  });
});

describe('M8-03 Fraunces self-hosting -- shipped font binary', () => {
  it('exists at the public path with the exact subset byte length (corruption tripwire)', () => {
    expect(statSync(woff2Path).size).toBe(34308);
  });
});
