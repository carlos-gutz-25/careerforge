import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ADVERSARIAL_CORPUS, ATTACK_CLASSES } from './index.ts';

// The corpus source-byte law (the automatable, enforceable version of the
// text.test.ts:5-8 visible-escape law): every fixture module's own SOURCE must
// be printable ASCII plus newline and tab only. Any non-ASCII codepoint a
// posting needs MUST be written as a visible \uXXXX escape. This kills the
// recurring literal-invisible-byte authoring bug at the point it is authored,
// not three layers downstream when a stored quote mysteriously flags.
const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

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

describe('corpus source-byte law (visible \\uXXXX escapes only)', () => {
  const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith('.ts'));

  it('finds at least the six class modules on disk', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fixtureFiles)(
    '%s source is printable ASCII only (no literal invisible bytes)',
    (name) => {
      const source = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
      const offsets = nonAsciiOffsets(source);
      // Name the file and the first offending offset so the failure points
      // straight at the byte to escape.
      expect(offsets, `${name}: non-ASCII byte(s) at char offset(s) ${offsets.join(', ')}`).toEqual(
        [],
      );
    },
  );

  it('this test file itself is printable ASCII only (the guard guards its own module)', () => {
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(nonAsciiOffsets(self)).toEqual([]);
  });
});

describe('corpus shape', () => {
  it('has unique fixture ids', () => {
    const ids = ADVERSARIAL_CORPUS.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every id is kebab-case', () => {
    for (const fixture of ADVERSARIAL_CORPUS) {
      expect(fixture.id, fixture.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('covers every attack class at least once', () => {
    const present = new Set(ADVERSARIAL_CORPUS.map((fixture) => fixture.class));
    for (const attackClass of ATTACK_CLASSES) {
      expect(present.has(attackClass), `no fixture for class ${attackClass}`).toBe(true);
    }
    // No fixture may carry a class outside the declared union.
    for (const attackClass of present) {
      expect(ATTACK_CLASSES).toContain(attackClass);
    }
  });

  it('every fixture declares at least one forbidden substring and one acceptable status', () => {
    for (const fixture of ADVERSARIAL_CORPUS) {
      expect(fixture.liveExpectation.forbiddenSubstrings.length, fixture.id).toBeGreaterThan(0);
      expect(fixture.liveExpectation.acceptableStatuses.length, fixture.id).toBeGreaterThan(0);
    }
  });

  it('every forbidden substring actually occurs in its own posting (the marker is real)', () => {
    // A canary that is not even present in the hostile posting could never
    // prove obedience -- this catches a typo'd marker at authoring time.
    for (const fixture of ADVERSARIAL_CORPUS) {
      for (const marker of fixture.liveExpectation.forbiddenSubstrings) {
        expect(fixture.postingText.includes(marker), `${fixture.id}: ${marker}`).toBe(true);
      }
    }
  });
});
