import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GAMEPLAN_ADVERSARIAL_CORPUS, GAMEPLAN_FIXTURE_CLASSES } from './index.ts';

// The corpus source-byte law applied to the gameplan corpus (the compose
// corpus.test.ts mirror): fixture SOURCE must be printable ASCII plus
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

describe('gameplan corpus source-byte law (visible \\uXXXX escapes only)', () => {
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

describe('gameplan corpus shape', () => {
  it('has unique kebab-case fixture ids', () => {
    const ids = GAMEPLAN_ADVERSARIAL_CORPUS.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every fixture class is a declared GAMEPLAN_FIXTURE_CLASSES member', () => {
    for (const fixture of GAMEPLAN_ADVERSARIAL_CORPUS) {
      expect(GAMEPLAN_FIXTURE_CLASSES).toContain(fixture.class);
    }
  });

  it('every clean-control fixture accepts exactly [ok] (the D7 tightened statuses)', () => {
    const cleanControls = GAMEPLAN_ADVERSARIAL_CORPUS.filter((f) => f.class === 'clean-control');
    expect(cleanControls.length).toBeGreaterThan(0);
    for (const fixture of cleanControls) {
      expect(fixture.liveExpectation.acceptableStatuses, fixture.id).toEqual(['ok']);
    }
  });

  it('every NON-clean fixture declares at least one forbidden substring (class-conditional; M7-08 inherits it)', () => {
    // Written class-conditional so M7-08's attack classes must carry obey-markers
    // while clean-control fixtures legitimately carry none.
    for (const fixture of GAMEPLAN_ADVERSARIAL_CORPUS) {
      if (fixture.class === 'clean-control') continue;
      expect(fixture.liveExpectation.forbiddenSubstrings.length, fixture.id).toBeGreaterThan(0);
    }
  });
});
