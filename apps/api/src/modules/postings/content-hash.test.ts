import { describe, expect, it } from 'vitest';

import { postingContentHash } from './content-hash.ts';

// The normalizeWhitespace unit tests moved to packages/core/src/text.test.ts
// with the M1-06 hoist; these hash pins independently prove the semantics
// survived the move (a normalization drift would break the equalities below).
describe('postingContentHash', () => {
  it('is stable across line-ending differences (CRLF vs LF)', () => {
    expect(postingContentHash('line one\r\nline two')).toBe(
      postingContentHash('line one\nline two'),
    );
  });

  it('is stable across leading/trailing whitespace', () => {
    expect(postingContentHash('  posting body \n')).toBe(postingContentHash('posting body'));
  });

  it('is stable across interior whitespace-run differences', () => {
    expect(postingContentHash('build   APIs')).toBe(postingContentHash('build APIs'));
  });

  it('differs for genuinely different text', () => {
    expect(postingContentHash('posting a')).not.toBe(postingContentHash('posting b'));
  });

  it('emits sha256 hex (64 lowercase hex chars)', () => {
    expect(postingContentHash('any text')).toMatch(/^[0-9a-f]{64}$/);
  });
});
