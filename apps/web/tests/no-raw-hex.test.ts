// @vitest-environment node
//
// M8-08 no-raw-hex ratchet. M8-07 restyled every SFC under apps/web/app off the
// 22 raw hex literals onto --color-* tokens; this gate LOCKS that in. It reads
// each `.vue` under app/ AS TEXT (no DOM, no Nuxt - hence the node environment,
// like the tokens-contrast gate) and FAILs on any raw hex color literal inside a
// `<style>` block. Colors in SFCs must come from tokens (`var(--color-*)`), so a
// new `#rrggbb` would silently re-open the hex sprawl the token layer closed.
//
// SCOPE: only `<style>` blocks of the SFCs (components/pages/layouts/app.vue).
//   - tokens.css / base.css are NOT scanned here - they are `.css`, not `.vue`,
//     and the contrast gate (tokens-contrast.test.ts) already owns them; tokens.css
//     is the ONE sanctioned home for hex literals (the token source of truth).
//   - `<template>` / `<script>` are not scanned: `#` there is slot syntax
//     (`<template #action>`), URL fragments (`href="#"`), etc. - never a CSS color.
// HEX ONLY (per the story name): rgb()/hsl()/named colors are intentionally NOT
//   flagged - they don't occur in the codebase and widening scope risks false
//   positives (e.g. `red` the keyword vs. an identifier). If they ever appear,
//   that is a follow-up ratchet, recorded as a deliberate boundary here.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const appDir = fileURLToPath(new URL('../app/', import.meta.url));

// Recursively collect every .vue under app/ (components, pages/**, layouts, app.vue).
function collectVueFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectVueFiles(`${path}/`));
    } else if (entry.name.endsWith('.vue')) {
      out.push(path);
    }
  }
  return out;
}

// A raw hex color literal: `#` + 3, 4, 6, or 8 hex digits, not part of a longer
// hex run. Alternation is longest-first so `#aabbcc` matches as 6 (not 3+tail);
// the trailing negative lookahead rejects a prefix of a longer identifier.
const HEX_LITERAL =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
// One `<style ...>...</style>` block; [1] is the inner CSS text.
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

interface Offender {
  file: string;
  line: number;
  hex: string;
}

const vueFiles = collectVueFiles(appDir);

// Scan the <style> blocks of every SFC; record file:line for each hex literal.
const offenders: Offender[] = [];
let filesWithStyle = 0;
for (const file of vueFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(appDir.length);
  let hadStyle = false;
  for (const block of text.matchAll(STYLE_BLOCK)) {
    hadStyle = true;
    const inner = block[1];
    // Loud, not skipped: this is a ratchet. A <style> block the regex cannot
    // read is a block whose hex literals go uncounted, which is exactly the
    // silent pass the gate exists to prevent.
    if (inner === undefined) throw new Error(`unreadable <style> block in ${rel}`);
    // Absolute offset in `text` where the inner CSS starts (past the opening tag).
    const innerStart = (block.index ?? 0) + block[0].indexOf('>') + 1;
    for (const hex of inner.matchAll(HEX_LITERAL)) {
      const absIndex = innerStart + (hex.index ?? 0);
      const line = text.slice(0, absIndex).split('\n').length;
      offenders.push({ file: rel, line, hex: hex[0] });
    }
  }
  if (hadStyle) filesWithStyle += 1;
}

describe('apps/web SFCs - no raw hex color literals in <style> (M8-08 ratchet)', () => {
  // Meta guard: a broken glob (wrong dir, zero matches) must FAIL loudly rather
  // than vacuously pass. M8-07 left ~9 styled SFCs; require the scan found real work.
  it('scanned the SFC tree and found styled components', () => {
    expect(vueFiles.length, 'no .vue files found under app/').toBeGreaterThan(0);
    expect(filesWithStyle, 'no SFC <style> blocks scanned').toBeGreaterThan(0);
  });

  it('no SFC <style> block contains a raw hex color literal', () => {
    const report = offenders.map((o) => `${o.file}:${o.line}: ${o.hex}`);
    expect(report, `raw hex in SFC <style>: ${report.join('; ')}`).toEqual([]);
  });
});
