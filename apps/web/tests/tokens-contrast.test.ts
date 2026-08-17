// @vitest-environment node
//
// The platform's own copy of the portfolio contrast gate (ADR-0016 §1: "two
// identities, one grammar" — each app carries its OWN copy of the text-parse
// gate, no shared package). It reads tokens.css AS TEXT and does WCAG arithmetic
// inline — no DOM, no Nuxt, no computed styles — so it opts out of the project's
// `nuxt` (happy-dom) environment, under which `import.meta.url` is not a file:
// URL and `fileURLToPath` throws.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(
  fileURLToPath(new URL('../app/assets/css/tokens.css', import.meta.url)),
  'utf8',
);

// --- WCAG 2.x relative luminance + contrast ratio (inline, 3-/6-digit hex) ---
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channelLuminance(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  // Destructure the tuple BEFORE mapping: Array.prototype.map widens
  // [number, number, number] to number[], which loses the arity the three
  // coefficients below depend on.
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const [hi, lo] = lFg >= lBg ? [lFg, lBg] : [lBg, lFg];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Parse --color-* tokens into { light, dark } hex values ---
const HEX = '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})';
const COLOR_DECL = /^\s*(--color-[a-z0-9-]+)\s*:\s*(.+?);\s*$/;
const LIGHT_DARK = new RegExp(`^light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)$`);
const BARE = new RegExp(`^${HEX}$`);

interface TokenValue {
  light: string;
  dark: string;
  raw: string;
}

const colors = new Map<string, TokenValue>();
for (const line of tokensCss.split('\n')) {
  const decl = line.match(COLOR_DECL);
  if (!decl) continue;
  const [, name, rawValue] = decl;
  // Both groups are mandatory in COLOR_DECL, so this cannot fire on a matching
  // line - it throws rather than `continue`s because silently dropping a token
  // would remove it from the contrast manifest, which is the gate's whole job.
  if (name === undefined || rawValue === undefined) {
    throw new Error(`unparsable --color token declaration: ${line}`);
  }
  const raw = rawValue.trim();
  const ld = raw.match(LIGHT_DARK);
  if (ld) {
    const [, light, dark] = ld;
    if (light === undefined || dark === undefined) {
      throw new Error(`unparsable light-dark() value for ${name}: ${raw}`);
    }
    colors.set(name, { light, dark, raw });
  } else if (BARE.test(raw)) {
    colors.set(name, { light: raw, dark: raw, raw });
  } else {
    // Grammar-invalid: recorded so guard (ii) reports it explicitly.
    colors.set(name, { light: '', dark: '', raw });
  }
}

// Explicit pairing manifest: [foreground token, background token, threshold].
// 4.5:1 for text (WCAG 1.4.3 AA); 3:1 for indicators + structural hairlines
// (WCAG 1.4.11 / 2.4.13). No decorative tier (ADR-0016 §4).
const AA_TEXT = 4.5;
const UI_INDICATOR = 3;
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ['--color-text', '--color-bg', AA_TEXT],
  ['--color-text', '--color-panel', AA_TEXT],
  ['--color-muted', '--color-bg', AA_TEXT],
  ['--color-muted', '--color-panel', AA_TEXT],
  ['--color-link', '--color-bg', AA_TEXT],
  ['--color-focus', '--color-bg', UI_INDICATOR],
  ['--color-border', '--color-bg', UI_INDICATOR],
  ['--color-border', '--color-panel', UI_INDICATOR],
  ['--color-accent', '--color-bg', AA_TEXT],
  ['--color-accent', '--color-draft-bg', AA_TEXT],
  ['--color-reviewed', '--color-bg', AA_TEXT],
  ['--color-reviewed', '--color-reviewed-bg', AA_TEXT],
  ['--color-danger', '--color-bg', AA_TEXT],
  ['--color-danger', '--color-danger-bg', AA_TEXT],
  ['--color-info', '--color-bg', AA_TEXT],
  ['--color-info', '--color-info-bg', AA_TEXT],
];

const MODES = ['light', 'dark'] as const;

describe('Dusk Console tokens — AA contrast gate (ADR-0016)', () => {
  it('parses the color tokens from tokens.css', () => {
    expect(colors.size).toBeGreaterThan(0);
  });

  for (const [fgName, bgName, threshold] of PAIRS) {
    for (const mode of MODES) {
      it(`${fgName} on ${bgName} meets ${threshold}:1 (${mode})`, () => {
        const fg = colors.get(fgName);
        const bg = colors.get(bgName);
        expect(fg, `missing token ${fgName}`).toBeDefined();
        expect(bg, `missing token ${bgName}`).toBeDefined();
        const ratio = contrastRatio(fg![mode], bg![mode]);
        expect(ratio).toBeGreaterThanOrEqual(threshold);
      });
    }
  }

  // Guard (i): a new color token cannot dodge the gate — it must be paired.
  it('every --color-* token participates in at least one contrast pair', () => {
    const paired = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
    const unpaired = [...colors.keys()].filter((name) => !paired.has(name));
    expect(unpaired, `unpaired color tokens: ${unpaired.join(', ')}`).toEqual([]);
  });

  // Guard (ii): every color value matches the grammar (parse failure = FAIL).
  it('every --color-* value is bare #hex or light-dark(#hex, #hex) (grammar)', () => {
    const violations: string[] = [];
    for (const [name, value] of colors) {
      const ok = LIGHT_DARK.test(value.raw) || BARE.test(value.raw);
      if (!ok) violations.push(`${name}: ${value.raw}`);
    }
    expect(violations, `grammar violations: ${violations.join('; ')}`).toEqual([]);
  });

  it('tokens.css opts into system dark mode via color-scheme', () => {
    expect(tokensCss).toMatch(/color-scheme:\s*light\s+dark/);
  });
});

// --- base.css + cross-file CSS-text gates ---
const cssDir = fileURLToPath(new URL('../app/assets/css/', import.meta.url));
const baseCss = readFileSync(
  fileURLToPath(new URL('../app/assets/css/base.css', import.meta.url)),
  'utf8',
);
const nuxtConfig = readFileSync(
  fileURLToPath(new URL('../nuxt.config.ts', import.meta.url)),
  'utf8',
);

describe('CSS foundations — base.css + cross-file ratchet (M8-06)', () => {
  // RATCHET: color tokens live ONLY in tokens.css. A --color-* declared in any
  // other stylesheet would dodge guard (i) entirely, so FAIL on it here.
  it('no --color-* token is declared outside tokens.css', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(cssDir)) {
      if (!file.endsWith('.css') || file === 'tokens.css') continue;
      const text = readFileSync(
        fileURLToPath(new URL(`../app/assets/css/${file}`, import.meta.url)),
        'utf8',
      );
      for (const line of text.split('\n')) {
        if (/^\s*--color-[a-z0-9-]+\s*:/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, `color tokens declared outside tokens.css: ${offenders.join('; ')}`).toEqual(
      [],
    );
  });

  it('base.css contains the reduced-motion kill switch', () => {
    expect(baseCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  // theme-color is a hand-copied second source of truth: nuxt.config's two
  // theme-color metas must equal --color-bg's light/dark values, or the browser
  // chrome drifts silently. Whitespace-tolerant so prettier wrapping can't break
  // the parse.
  it('theme-color metas match --color-bg light/dark (no drift)', () => {
    const bg = colors.get('--color-bg');
    expect(bg, 'missing --color-bg token').toBeDefined();
    const byMode: Record<string, string> = {};
    const re =
      /theme-color'[\s\S]*?content:\s*'(#[0-9a-fA-F]{3,6})'[\s\S]*?media:\s*'\(prefers-color-scheme:\s*(light|dark)\)'/g;
    for (const match of nuxtConfig.matchAll(re)) {
      const [, content, mode] = match;
      // A skipped meta leaves byMode.light/dark undefined, which the two
      // assertions below report by name - so the gate still fails loudly.
      if (content === undefined || mode === undefined) continue;
      byMode[mode] = content.toLowerCase();
    }
    expect(byMode.light, 'no light-mode theme-color meta').toBe(bg!.light.toLowerCase());
    expect(byMode.dark, 'no dark-mode theme-color meta').toBe(bg!.dark.toLowerCase());
  });
});
