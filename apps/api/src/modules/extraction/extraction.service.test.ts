// R1 behavior pins (external code review, M1-05): the raw-response sanitizer
// strips real U+0000 CHARACTERS on the parsed structure and never touches the
// literal 6-char escape TEXT backslash-u-0000 — the serialized-JSON text
// replacement it replaced could not tell the two apart and corrupted the
// text case (route-level regression lives in extraction.routes.test.ts).
import { describe, expect, it } from 'vitest';

import { stripNulChars, toPlainJson } from './extraction.service.ts';

// The real character, constructed — no literal NUL byte in this source file.
const NUL = String.fromCharCode(0);

describe('raw-response NUL sanitization (R1)', () => {
  it('(a) literal backslash-u-0000 TEXT survives byte-identical, no throw', () => {
    const input = {
      q: 'code: \\u0000 terminator',
      nested: { list: ['\\u0000', 'plain'] },
    };
    expect(stripNulChars(toPlainJson(input))).toEqual(input);
  });

  it('(b) real U+0000 characters are stripped from string VALUES and object KEYS', () => {
    const input = {
      [`ke${NUL}y`]: `va${NUL}lue`,
      arr: [`x${NUL}${NUL}y`, 7, true, null],
      untouched: 'plain string',
    };
    expect(stripNulChars(toPlainJson(input))).toEqual({
      key: 'value',
      arr: ['xy', 7, true, null],
      untouched: 'plain string',
    });
  });

  it('a mixed payload keeps the text form while losing the character', () => {
    const input = { s: `literal \\u0000 and real${NUL} together` };
    expect(stripNulChars(toPlainJson(input))).toEqual({
      s: 'literal \\u0000 and real together',
    });
  });

  it('toPlainJson normalizes non-JSON values instead of throwing', () => {
    expect(toPlainJson(undefined)).toBeNull();
    expect(toPlainJson({ keep: 1, drop: undefined })).toEqual({ keep: 1 });
  });
});
