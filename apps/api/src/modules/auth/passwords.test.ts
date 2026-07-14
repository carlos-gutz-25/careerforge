import { describe, expect, it } from 'vitest';

import {
  ARGON2_MEMORY_COST_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
  passwords,
} from './passwords.ts';

// Fictional test password — never a real credential.
const PASSWORD = 'fictional-unit-test-password';

describe('hashPassword', () => {
  it('produces an argon2id hash carrying the OWASP parameters', async () => {
    const hash = await passwords.hashPassword(PASSWORD);
    // The encoded params are the contract — library defaults must not drift.
    expect(hash).toContain('$argon2id$');
    expect(hash).toContain(
      `m=${ARGON2_MEMORY_COST_KIB},t=${ARGON2_TIME_COST},p=${ARGON2_PARALLELISM}`,
    );
  });

  it('salts: hashing the same password twice differs', async () => {
    expect(await passwords.hashPassword(PASSWORD)).not.toBe(await passwords.hashPassword(PASSWORD));
  });
});

describe('verifyPassword', () => {
  it('round-trips a correct password', async () => {
    const hash = await passwords.hashPassword(PASSWORD);
    expect(await passwords.verifyPassword(hash, PASSWORD)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await passwords.hashPassword(PASSWORD);
    expect(await passwords.verifyPassword(hash, 'wrong-password-entirely')).toBe(false);
  });

  it('returns false (not a throw) on a malformed stored hash — the seed example user', async () => {
    // Mirrors packages/db seed: intentionally never a valid argon2 hash.
    expect(
      await passwords.verifyPassword('unverifiable-by-design-example-user-cannot-log-in', PASSWORD),
    ).toBe(false);
    expect(await passwords.verifyPassword('', PASSWORD)).toBe(false);
  });
});
