// @vitest-environment node
//
// M8-22 wiring gate -- pure text-parse (mirrors apps/portfolio/tests/fonts.test.ts
// and tokens-contrast.test.ts): reads fonts.css, tokens.css and nuxt.config.ts AS
// TEXT and inspects the shipped font binaries. It asserts the self-hosted Archivo
// + JetBrains Mono faces, their metric-adjusted fallbacks, the preload wiring, the
// token stacks, and the binaries themselves. No DOM/Nuxt dependency -> `node` env
// (import.meta.url is a file: URL here; happy-dom breaks fileURLToPath).
//
// WHY THE MAGIC-BYTE ASSERTION EXISTS (it is not ceremony): a font pipeline that
// subsets/instances with fonttools writes a raw sfnt unless `--flavor=woff2` is
// passed. The result is a TrueType file with a .woff2 name that browsers still
// render -- so nothing looks broken -- while the `format('woff2')` hint is false
// and the asset ships uncompressed. A byte-length tripwire alone does NOT catch
// it. This repo has a live instance of exactly that defect on another surface
// (notes/portfolio-font-not-woff2-2026-08-13.md), which is why this gate checks
// the signature and not just the size.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const fontsCss = read('../app/assets/css/fonts.css');
const tokensCss = read('../app/assets/css/tokens.css');
const nuxtConfig = read('../nuxt.config.ts');

const fontPath = (name: string) =>
  fileURLToPath(new URL(`../public/fonts/${name}`, import.meta.url));

// Lines trimmed of leading/trailing whitespace -- used for EXACT-string matches so
// a substring cannot satisfy the wrong assertion ('Archivo' is a substring of
// 'Archivo Fallback', and 'JetBrains Mono' of 'JetBrains Mono Fallback').
const lines = fontsCss.split('\n').map((l) => l.trim());
const countExact = (s: string) => lines.filter((l) => l === s).length;

// name -> exact byte length of the shipped upstream latin subset. Doubles as a
// corruption/substitution tripwire: any re-subset or re-encode moves these.
const SHIPPED = {
  'Archivo-latin-400.woff2': 14672,
  'Archivo-latin-600.woff2': 13844,
  'JetBrainsMono-latin-400.woff2': 21168,
  'JetBrainsMono-latin-600.woff2': 21860,
} as const;

const PRELOADED = ['Archivo-latin-400.woff2', 'JetBrainsMono-latin-400.woff2'] as const;

describe('M8-22 Dusk Console fonts -- fonts.css', () => {
  it('declares exactly one real @font-face per family per weight (exact quoted family)', () => {
    // The full quoted token incl. closing quote + semicolon, never a substring --
    // '<Family> Fallback' also contains '<Family>'.
    expect(countExact("font-family: 'Archivo';")).toBe(2);
    expect(countExact("font-family: 'JetBrains Mono';")).toBe(2);
  });

  it('ships BOTH real weights per family so the browser never synthesises faux bold', () => {
    // The console sets font-weight: 600 in many places; shipping 400 alone would
    // smear stems at the 13-16px sizes this UI lives at.
    expect(fontsCss).toMatch(/font-weight:\s*400;/);
    expect(fontsCss).toMatch(/font-weight:\s*600;/);
  });

  it('uses font-display: optional on every real face (no swap period -> no late repaint)', () => {
    const faces = fontsCss.match(/font-display:\s*optional;/g) ?? [];
    expect(faces).toHaveLength(4);
  });

  it('src references the self-hosted subsets, never a CDN', () => {
    for (const name of Object.keys(SHIPPED)) {
      expect(fontsCss).toContain(`url('/fonts/${name}') format('woff2')`);
    }
    expect(fontsCss).not.toMatch(/https?:\/\//);
  });

  it('declares a distinct metric-adjusted fallback per family with all four overrides', () => {
    expect(countExact("font-family: 'Archivo Fallback';")).toBe(1);
    expect(countExact("font-family: 'JetBrains Mono Fallback';")).toBe(1);
    for (const prop of [
      'size-adjust',
      'ascent-override',
      'descent-override',
      'line-gap-override',
    ]) {
      // One occurrence per fallback face.
      const hits = fontsCss.match(new RegExp(`${prop}:\\s*[\\d.]+%;`, 'g')) ?? [];
      expect(hits).toHaveLength(2);
    }
  });

  it('declares no color token, so the tokens.css colour ratchet is unaffected', () => {
    // DECLARATIONS, not mentions: the header comment discusses --color-* by name,
    // and a bare /--color-/ would flag that prose. Strip block comments first.
    const code = fontsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/^\s*--color-[a-z-]+\s*:/m);
  });
});

describe('M8-22 Dusk Console fonts -- token stacks (tokens.css)', () => {
  it('leads --font-ui and --font-mono with the self-hosted face, then its metric fallback', () => {
    // Order is load-bearing: webfont, then the metric-adjusted local face that
    // holds the layout, then the generic stack.
    expect(tokensCss).toMatch(/--font-ui:\s*[\r\n\s]*'Archivo',\s*'Archivo Fallback',/);
    expect(tokensCss).toMatch(
      /--font-mono:\s*[\r\n\s]*'JetBrains Mono',\s*'JetBrains Mono Fallback',/,
    );
  });
});

describe('M8-22 Dusk Console fonts -- preload wiring (nuxt.config.ts)', () => {
  it('preloads the two weight-400 subsets as fonts with crossorigin', () => {
    // crossorigin is required even same-origin, else the preload double-fetches.
    for (const name of PRELOADED) {
      expect(nuxtConfig).toContain(`href: '/fonts/${name}'`);
    }
    expect(nuxtConfig).toMatch(/rel:\s*'preload'/);
    expect(nuxtConfig).toMatch(/as:\s*'font'/);
    expect(nuxtConfig).toMatch(/type:\s*'font\/woff2'/);
    expect(nuxtConfig).toMatch(/crossorigin:/);
  });

  it('does NOT preload the 600 weights (they are never the first paint)', () => {
    expect(nuxtConfig).not.toContain('Archivo-latin-600.woff2');
    expect(nuxtConfig).not.toContain('JetBrainsMono-latin-600.woff2');
  });

  it('loads fonts.css through the global css array', () => {
    expect(nuxtConfig).toContain("'~/assets/css/fonts.css'");
  });
});

describe('M8-22 Dusk Console fonts -- shipped binaries', () => {
  it.each(Object.entries(SHIPPED))('%s exists at the exact subset byte length', (name, bytes) => {
    expect(statSync(fontPath(name)).size).toBe(bytes);
  });

  it.each(Object.keys(SHIPPED))('%s is really WOFF2, not an sfnt with a .woff2 name', (name) => {
    // WOFF2 signature is 'wOF2'. A raw TrueType starts 0x00010000, and an OpenType
    // /CFF one starts 'OTTO' -- both would still render, and both would make the
    // format('woff2') hint above a lie while shipping uncompressed bytes.
    const magic = readFileSync(fontPath(name)).subarray(0, 4).toString('latin1');
    expect(magic).toBe('wOF2');
  });

  it('ships the OFL licence text alongside the binaries (SIL OFL-1.1 requires it)', () => {
    for (const licence of ['OFL-Archivo.txt', 'OFL-JetBrainsMono.txt']) {
      expect(readFileSync(fontPath(licence), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    }
  });
});
