// @vitest-environment node
//
// This is a pure text-parse gate — it reads tokens.css as a string and does
// arithmetic. It has no DOM or Nuxt dependency, so it opts out of the project's
// `nuxt` (happy-dom) environment, under which `import.meta.url` is not a
// file: URL and `fileURLToPath` throws.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The gate reads tokens.css AS TEXT — it never imports the stylesheet and never
// reads a computed style, so it is independent of any framework CSS handling
// (D1/D5 rationale). WCAG relative-luminance math is inline, no dependency (D3).
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
  const [r, g, b] = hexToRgb(hex).map(channelLuminance);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
  const raw = rawValue.trim();
  const ld = raw.match(LIGHT_DARK);
  if (ld) {
    colors.set(name, { light: ld[1], dark: ld[2], raw });
  } else if (BARE.test(raw)) {
    colors.set(name, { light: raw, dark: raw, raw });
  } else {
    // Grammar-invalid: recorded so guard (ii) reports it explicitly.
    colors.set(name, { light: '', dark: '', raw });
  }
}

// Explicit pairing manifest: [foreground token, background token, threshold].
// 4.5:1 for text (WCAG 1.4.3 AA); 3:1 for the focus indicator (1.4.11 / 2.4.13).
const AA_TEXT = 4.5;
const UI_INDICATOR = 3;
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ['--color-text', '--color-bg', AA_TEXT],
  ['--color-muted', '--color-bg', AA_TEXT],
  ['--color-link', '--color-bg', AA_TEXT],
  ['--color-focus', '--color-bg', UI_INDICATOR],
  ['--color-skip-fg', '--color-skip-bg', AA_TEXT],
];

const MODES = ['light', 'dark'] as const;

describe('design tokens — AA contrast gate (D2/D5)', () => {
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

  // Guard (ii): every color value matches the D5 grammar (parse failure = FAIL).
  it('every --color-* value is bare #hex or light-dark(#hex, #hex) (D5 grammar)', () => {
    const violations: string[] = [];
    for (const [name, value] of colors) {
      const ok = LIGHT_DARK.test(value.raw) || BARE.test(value.raw);
      if (!ok) violations.push(`${name}: ${value.raw}`);
    }
    expect(violations, `grammar violations: ${violations.join('; ')}`).toEqual([]);
  });
});
