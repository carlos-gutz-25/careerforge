import { describe, expect, it } from 'vitest';

import { normalizeForHash, postingContentHash } from './content-hash.ts';

describe('normalizeForHash', () => {
  it('collapses whitespace runs and trims the ends', () => {
    expect(normalizeForHash('  Senior\tEngineer\r\n\nRemote  ')).toBe('Senior Engineer Remote');
  });
});

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
