// @vitest-environment node
//
// M8-24 state-signature gate. The draft/reviewed distinction is the console's
// visual signature for the draft-until-reviewed law, and the binding constraint
// (Story B plan, D3) is that it must read TYPOGRAPHICALLY and STRUCTURALLY -
// never by color alone, because color alone is invisible to anyone who cannot
// separate amber from green, and to any greyscale rendering.
//
// So this gate asserts the property the eye cannot check on every future diff:
// that after you delete every color-bearing declaration from the draft and
// reviewed rules, SOMETHING STILL TELLS THEM APART. Before M8-24 that was false
// - the two rules differed only in `color`, `background`, and `border-color`.
//
// It reads the SFC AS TEXT (hence the node environment, matching
// tokens-contrast.test.ts) because the thing under test is the authored CSS, not
// a computed style: happy-dom would not resolve `light-dark()` or the cascade,
// and a mounted chip would tell us what the browser did, not what we committed.
//
// Deliberately parsed, not grepped: CSS COMMENTS ARE STRIPPED FIRST and the
// assertions run against declaration bodies only. A gate that searched the whole
// file for "dashed" would be satisfied by the prose comment ABOVE the rule that
// explains why dashed is used - the author's own words passing the author's own
// gate. That failure mode is banked lane law, not a hypothetical.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const chipSfc = readFileSync(
  fileURLToPath(new URL('../app/components/AppStateChip.vue', import.meta.url)),
  'utf8',
);

// Every declaration whose value is a color. These are exactly the channels that
// D3 says may NOT carry the distinction on their own, so the gate subtracts them
// before looking for a difference.
const COLOR_PROPS = new Set(['color', 'background', 'background-color', 'border-color']);

/** Strip CSS block comments so authored prose can never satisfy an assertion. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Return the declarations of a single class rule as a property->value map.
 * Throws if the rule is absent: a missing rule must fail loudly rather than
 * yield an empty object that silently satisfies a "they differ" assertion.
 */
function declarationsFor(selector: string): Record<string, string> {
  const css = stripCssComments(chipSfc);
  // Match the exact selector followed by its block - `\s*\{([^}]*)\}` is safe
  // here because CSS declaration blocks in this SFC contain no nested braces.
  const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  if (rule === null) {
    throw new Error(`state-signature gate: rule "${selector}" not found in AppStateChip.vue`);
  }

  const declarations: Record<string, string> = {};
  for (const raw of (rule[1] ?? '').split(';')) {
    const text = raw.trim();
    if (text === '') continue;
    const split = text.indexOf(':');
    if (split === -1) continue;
    const prop = text.slice(0, split).trim();
    declarations[prop] = text.slice(split + 1).trim();
  }
  return declarations;
}

/** The declarations that survive removing color - i.e. what works in greyscale. */
function nonColorDeclarations(selector: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(declarationsFor(selector)).filter(([prop]) => !COLOR_PROPS.has(prop)),
  );
}

describe('M8-24 draft/reviewed signature survives the loss of color', () => {
  it('parses real declarations, not prose (control on the parser itself)', () => {
    // If this ever fails, every other assertion in the file is meaningless -
    // so the parser is positive-controlled before it is trusted (lane lesson 4).
    const draft = declarationsFor('.app-chip--draft');
    expect(draft.color).toBe('var(--color-accent)');
    // The word "dashed" appears in the comment above the rule; the parser must
    // have taken it from the DECLARATION, so the property lookup must resolve.
    expect(Object.keys(draft)).toContain('border-style');
  });

  it('distinguishes draft from reviewed WITHOUT any color declaration', () => {
    const draft = nonColorDeclarations('.app-chip--draft');
    const reviewed = nonColorDeclarations('.app-chip--reviewed');

    // Non-empty, or "they differ" would be trivially satisfiable by emptiness.
    expect(Object.keys(draft).length).toBeGreaterThan(0);
    expect(Object.keys(reviewed).length).toBeGreaterThan(0);
    expect(draft).not.toEqual(reviewed);
  });

  // Each carrier is asserted INDEPENDENTLY on purpose. A single "the sets
  // differ" assertion would stay green if one carrier were deleted, since the
  // other would still make the sets unequal - so the gate would not notice the
  // signature being quietly halved.
  it('carries the distinction structurally: the border style differs', () => {
    const draft = declarationsFor('.app-chip--draft');
    const reviewed = declarationsFor('.app-chip--reviewed');

    expect(draft['border-style']).toBeDefined();
    expect(reviewed['border-style']).toBeDefined();
    expect(draft['border-style']).not.toBe(reviewed['border-style']);
  });

  it('carries the distinction typographically: the font weight differs', () => {
    const draft = declarationsFor('.app-chip--draft');
    const reviewed = declarationsFor('.app-chip--reviewed');

    expect(draft['font-weight']).toBeDefined();
    expect(reviewed['font-weight']).toBeDefined();
    expect(draft['font-weight']).not.toBe(reviewed['font-weight']);
  });

  it('adds no color token - the palette is untouched by this story (D1(3))', () => {
    // M8-24 may reuse the existing semantic pairs but must not mint a new one.
    // Any raw hex here would also trip the M8-08 ratchet; this asserts the
    // narrower story-level rule that the chip introduces no NEW color channel.
    for (const selector of ['.app-chip--draft', '.app-chip--reviewed']) {
      for (const [prop, value] of Object.entries(declarationsFor(selector))) {
        if (!COLOR_PROPS.has(prop)) continue;
        expect(value).toMatch(/^var\(--color-[a-z-]+\)$/);
      }
    }
  });
});
