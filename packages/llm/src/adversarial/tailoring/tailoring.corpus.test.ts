import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildTailoringPayload } from '../../drafting/tailoring-payload.ts';
import { TAILORING_ADVERSARIAL_CORPUS, TAILORING_ATTACK_CLASSES } from './index.ts';

// The corpus source-byte law applied to the tailoring corpus (the drafting
// corpus.test mirror): fixture SOURCE must be printable ASCII plus
// newline/tab/CR only; any non-ASCII codepoint MUST be a visible \uXXXX escape.

function nonAsciiOffsets(source: string): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    const printableAscii = code >= 0x20 && code <= 0x7e;
    const allowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!printableAscii && !allowedControl) offsets.push(i);
  }
  return offsets;
}

describe('tailoring corpus source-byte law (visible \\uXXXX escapes only)', () => {
  it.each(['./fixtures.ts', './index.ts'])('%s source is printable ASCII only', (name) => {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    const offsets = nonAsciiOffsets(source);
    expect(offsets, `${name}: non-ASCII byte(s) at char offset(s) ${offsets.join(', ')}`).toEqual(
      [],
    );
  });

  it('this test file itself is printable ASCII only (the guard guards its own module)', () => {
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(nonAsciiOffsets(self)).toEqual([]);
  });
});

describe('tailoring corpus shape', () => {
  it('has unique kebab-case fixture ids', () => {
    const ids = TAILORING_ADVERSARIAL_CORPUS.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('covers every declared tailoring attack class exactly, no strays', () => {
    const present = new Set(TAILORING_ADVERSARIAL_CORPUS.map((fixture) => fixture.class));
    for (const attackClass of TAILORING_ATTACK_CLASSES) {
      expect(present.has(attackClass), `no fixture for class ${attackClass}`).toBe(true);
    }
    for (const attackClass of present) {
      expect(TAILORING_ATTACK_CLASSES).toContain(attackClass);
    }
  });

  it('every fixture declares at least one forbidden substring and one acceptable status', () => {
    for (const fixture of TAILORING_ADVERSARIAL_CORPUS) {
      expect(fixture.liveExpectation.forbiddenSubstrings.length, fixture.id).toBeGreaterThan(0);
      expect(fixture.liveExpectation.acceptableStatuses.length, fixture.id).toBeGreaterThan(0);
    }
  });

  it('every forbidden marker actually occurs in its own BUILT payload (the marker is real)', () => {
    // A canary absent from the delimited payload could never prove obedience --
    // this catches a typo'd marker (or an attack string parked in an excluded
    // field) at authoring time.
    for (const fixture of TAILORING_ADVERSARIAL_CORPUS) {
      const built = buildTailoringPayload(
        fixture.skills,
        fixture.experiences,
        fixture.projects,
        fixture.gaps,
        fixture.evidence,
      );
      for (const marker of fixture.liveExpectation.forbiddenSubstrings) {
        expect(built.payload.includes(marker), `${fixture.id}: ${marker}`).toBe(true);
      }
    }
  });
});
