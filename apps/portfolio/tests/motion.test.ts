// @vitest-environment node
//
// M8-05 wiring gate -- pure text-parse (mirrors fonts.test.ts / tokens-contrast.test.ts):
// reads motion.css AS TEXT and pins the two reduced-motion SAFETY invariants that
// NO existing gate checks. a11y=1.0 is a STRICT law and motion is the whole risk of
// this story:
//   (i)  the reveal animation is scoped INSIDE
//        @media (prefers-reduced-motion: no-preference) -- motion is opt-in, never
//        unconditional, so a reduced-motion user gets the static end-state.
//   (ii) opacity:0 appears ONLY inside a @keyframes body -- never as a base state,
//        so content is never dependent on the animation to become visible (the
//        stuck-invisible pattern this test exists to ban).
// No DOM/Nuxt dependency -> `node` env (import.meta.url is a file: URL here;
// happy-dom breaks fileURLToPath).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const motionCssRaw = readFileSync(
  fileURLToPath(new URL('../app/assets/css/motion.css', import.meta.url)),
  'utf8',
);

// Strip CSS comments before scanning: these invariants are about DECLARATIONS,
// not the prose in comments (which legitimately names "opacity:0" and
// "animation" while describing the rules). Replace each comment with a space so
// line/brace structure outside comments is preserved.
const motionCss = motionCssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ');

// Return the body + end index of the first brace block whose opening `{` follows
// headerIdx, matched by brace counting (so nested from/to blocks are included and
// the block ends at its OWN matching `}`). end = index just past the closing `}`.
function blockAfter(src: string, headerIdx: number): { body: string; end: number } | null {
  const open = src.indexOf('{', headerIdx);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

// Concatenated bodies of every @keyframes block in the source.
function keyframesBodies(src: string): string {
  let out = '';
  const re = /@keyframes\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const blk = blockAfter(src, m.index);
    if (blk) {
      out += blk.body;
      re.lastIndex = blk.end;
    }
  }
  return out;
}

// opacity:0 but NOT opacity:0.5 / opacity:0px etc.
const OPACITY_ZERO = /opacity:\s*0(?![.\d])/g;
const REVEAL_ANIMATION = /animation:\s*reveal-rise\b/;

describe('M8-05 motion -- reduced-motion safety (motion.css)', () => {
  it('scopes the reveal animation INSIDE @media (prefers-reduced-motion: no-preference)', () => {
    const headerIdx = motionCss.search(
      /@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)/,
    );
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    const blk = blockAfter(motionCss, headerIdx);
    expect(blk).not.toBeNull();
    // the reveal shorthand referencing the keyframe lives inside the guard...
    expect(blk!.body).toMatch(REVEAL_ANIMATION);
    // ...and NOWHERE outside it (motion is never unconditional).
    const outside = motionCss.slice(0, headerIdx) + motionCss.slice(blk!.end);
    expect(outside).not.toMatch(REVEAL_ANIMATION);
  });

  it('never declares opacity:0 as a base state (only a @keyframes body may)', () => {
    // The shipped reveal is TRANSFORM-ONLY (LCP cushion step b), so no opacity is
    // animated -- opacity:0 should not appear at all. This is the FORWARD guard for
    // the tightened invariant: IF opacity:0 ever appears it must be inside a
    // @keyframes body, never as a static base state (an element depending on the
    // animation to clear -- the stuck-invisible pattern this test bans). With zero
    // occurrences today it holds trivially and catches any future base opacity:0.
    const totalInFile = (motionCss.match(OPACITY_ZERO) || []).length;
    const inKeyframes = (keyframesBodies(motionCss).match(OPACITY_ZERO) || []).length;
    expect(inKeyframes).toBe(totalInFile);
  });

  it('declares NO --color-* token (the tokens-contrast ratchet also governs this file)', () => {
    // Mirrors the ratchet's own decl regex; motion.css must stay color-free so the
    // no-planted-FAIL-owed conclusion holds (only --reveal-index, a non-color var).
    const colorDecls = motionCss.split('\n').filter((l) => /^\s*--color-[a-z0-9-]+\s*:/.test(l));
    expect(colorDecls).toEqual([]);
  });
});
