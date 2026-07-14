import { describe, expect, it } from 'vitest';

import { generateSessionToken, hashSessionToken } from './tokens.ts';

describe('generateSessionToken', () => {
  it('emits 256 bits as base64url', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSessionToken));
    expect(tokens.size).toBe(100);
  });
});

describe('hashSessionToken', () => {
  it('is deterministic hex SHA-256 (the DB lookup key)', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hash);
    expect(hashSessionToken('a-different-token')).not.toBe(hash);
  });
});
