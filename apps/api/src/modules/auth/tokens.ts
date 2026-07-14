import { createHash, randomBytes } from 'node:crypto';

// Session token = 256 bits from the CSPRNG, base64url (43 chars). The raw
// token exists only in the cookie; the DB stores SHA-256(token) (schema
// contract, packages/db/src/schema/auth.ts). A fast hash is correct here:
// argon2's cost defends low-entropy human secrets, while a 256-bit random
// value is unguessable at any hash speed — and a deterministic digest is what
// lets lookups hit the token_hash unique index.
export const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
