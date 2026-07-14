import { type Algorithm, hash, verify } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet minimum-recommended argon2id parameters
// for interactive login (m=19456 KiB / t=2 / p=1). Passed explicitly on every
// call — library defaults must never drift these silently.
export const ARGON2_MEMORY_COST_KIB = 19456;
export const ARGON2_TIME_COST = 2;
export const ARGON2_PARALLELISM = 1;

// Algorithm.Argon2id — the enum is ambient-const (unreadable at runtime under
// verbatimModuleSyntax), so the value is pinned here and the unit test pins
// the "$argon2id$" prefix of the encoded output, which would catch any drift.
const ARGON2ID = 2 as Algorithm;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: ARGON2_MEMORY_COST_KIB,
  timeCost: ARGON2_TIME_COST,
  parallelism: ARGON2_PARALLELISM,
};

/** Injected into the auth service so tests can observe/replace it. */
export interface Passwords {
  hashPassword(password: string): Promise<string>;
  /** False (never a throw) on mismatch OR malformed stored hash — the seed's
   *  example user carries an intentionally-invalid hash and must simply fail
   *  to authenticate, not 500. */
  verifyPassword(storedHash: string, password: string): Promise<boolean>;
}

export const passwords: Passwords = {
  hashPassword: (password) => hash(password, ARGON2_OPTIONS),
  async verifyPassword(storedHash, password) {
    try {
      return await verify(storedHash, password);
    } catch {
      return false;
    }
  },
};
