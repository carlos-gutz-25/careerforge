import {
  createSessionsRepository,
  createUsersRepository,
  type DbHandle,
  type Session,
  type User,
} from '@careerforge/db';
import { resolveTestDatabaseUrl } from '@careerforge/db/test-utils';

import { parseEnv, type Env } from '../env.ts';
import { SESSION_TTL_MS } from '../modules/auth/auth.service.ts';
import { passwords } from '../modules/auth/passwords.ts';
import { generateSessionToken, hashSessionToken } from '../modules/auth/tokens.ts';

// Every credential in this file is fictional (ADR-0007: tests never touch the
// real env-seeded user).
export const TEST_USER = {
  email: 'casey.tester@example.com',
  password: 'fictional-integration-password',
};

/** Valid env pointing at careerforge_test; overridable per test. */
export function buildTestEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal', // keep expected-error noise out of test output
    DATABASE_URL: resolveTestDatabaseUrl(),
    AUTH_BOOTSTRAP_EMAIL: 'env.bootstrap.fictional@example.com',
    AUTH_BOOTSTRAP_PASSWORD: 'fictional-bootstrap-password',
    ...overrides,
  });
}

/** Inserts a user with a real argon2id hash so full login flows work. */
export async function createTestUser(
  handle: DbHandle,
  { email, password } = TEST_USER,
): Promise<User> {
  return createUsersRepository(handle.db).create({
    email,
    passwordHash: await passwords.hashPassword(password),
  });
}

/**
 * Inserts a session row directly (repo-level), returning the raw cookie
 * token — the fixture path for expiry tests, which need control over
 * expires_at that the login route rightly doesn't offer.
 */
export async function createSessionRow(
  handle: DbHandle,
  userId: string,
  expiresAt = new Date(Date.now() + SESSION_TTL_MS),
): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const session = await createSessionsRepository(handle.db).create({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });
  return { token, session };
}
