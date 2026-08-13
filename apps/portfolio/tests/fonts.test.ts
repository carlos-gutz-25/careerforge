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
  new URL('../public/fonts/Fraunces-latin-opsz30.woff2', import.meta.url),
);
// M8-21: the hero display cut is a SECOND instance + a page-scoped preload, so
// the gate reads one more binary and one more file (the home page).
const displayWoff2Path = fileURLToPath(
  new URL('../public/fonts/Fraunces-latin-display.woff2', import.meta.url),
);
const indexVue = readFileSync(
  fileURLToPath(new URL('../app/pages/index.vue', import.meta.url)),
  'utf8',
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

  it('declares the single static instance weight 600 (matches the pinned subset; never weight-unset)', () => {
    // The opsz-30 subset is a STATIC single-weight (600) instance -- keeping the
    // wght axis variable blew the 40KB latin budget (see fonts.css). Every
    // heading sets weight 600 explicitly, so no faux-weight synthesis occurs.
    expect(fontsCss).toMatch(/font-weight:\s*600;/);
  });

  it('uses font-display: optional (abort-ramp step 1: no swap period -> no late LCP repaint)', () => {
    expect(fontsCss).toMatch(/font-display:\s*optional;/);
  });

  it('src references the self-hosted woff2 subset', () => {
    expect(fontsCss).toMatch(
      /src:\s*url\('\/fonts\/Fraunces-latin-opsz30\.woff2'\)\s*format\('woff2'\);/,
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
    expect(nuxtConfig).toMatch(/href:\s*'\/fonts\/Fraunces-latin-opsz30\.woff2'/);
    expect(nuxtConfig).toMatch(/crossorigin:/);
  });
});

describe('M8-03 Fraunces self-hosting -- shipped font binary', () => {
  it('exists at the public path with the exact subset byte length (corruption tripwire)', () => {
    expect(statSync(woff2Path).size).toBe(34424);
  });
});

describe('M8-21 hero display cut -- second Fraunces instance', () => {
  it('declares exactly one real Fraunces Display @font-face (exact quoted family)', () => {
    // Same substring hazard as the opsz30 face: 'Fraunces Display Fallback'
    // contains 'Fraunces Display', so match the FULL quoted token.
    expect(countExact("font-family: 'Fraunces Display';")).toBe(1);
  });

  it('src references the self-hosted display woff2 subset', () => {
    expect(fontsCss).toMatch(
      /src:\s*url\('\/fonts\/Fraunces-latin-display\.woff2'\)\s*format\('woff2'\);/,
    );
  });

  it('declares a distinct metric-adjusted display fallback with all four overrides', () => {
    // Guards the D2 metric-fallback rail for the hero face specifically: a
    // fallback face that lost its overrides reflows the LCP heading on slow
    // connections, which is exactly what the metric adjustment exists to stop.
    expect(countExact("font-family: 'Fraunces Display Fallback';")).toBe(1);
    const displayFallback = fontsCss.slice(
      fontsCss.indexOf("font-family: 'Fraunces Display Fallback';"),
    );
    expect(displayFallback).toMatch(/size-adjust:\s*[\d.]+%;/);
    expect(displayFallback).toMatch(/ascent-override:\s*[\d.]+%;/);
    expect(displayFallback).toMatch(/descent-override:\s*[\d.]+%;/);
    expect(displayFallback).toMatch(/line-gap-override:\s*[\d.]+%;/);
  });

  it('ships the display binary at the public path with its exact byte length', () => {
    // Second-file byte tripwire (the M8-21 acceptance criterion), and the 40KB
    // latin budget guard: a rebuild that silently retains a variable axis blows
    // past this number rather than shipping quietly.
    expect(statSync(displayWoff2Path).size).toBe(17308);
    expect(statSync(displayWoff2Path).size).toBeLessThanOrEqual(40960);
  });

  it('preloads the display woff2 from the home page, not globally', () => {
    // The face is consumed by .hero-name, which only the home page renders.
    // Preloading it in nuxt.config.ts would cost every other gated page a 17KB
    // fetch it never uses, so the preload MUST live on the page.
    expect(indexVue).toMatch(/href:\s*'\/fonts\/Fraunces-latin-display\.woff2'/);
    expect(indexVue).toMatch(/rel:\s*'preload'/);
    expect(indexVue).toMatch(/crossorigin:/);
    expect(nuxtConfig).not.toMatch(/Fraunces-latin-display\.woff2/);
  });
});
