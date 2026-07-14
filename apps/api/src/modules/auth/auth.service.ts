import {
  type Session,
  type SessionsRepository,
  type User,
  type UsersRepository,
} from '@careerforge/db';

import { type Passwords } from './passwords.ts';
import { generateSessionToken, hashSessionToken } from './tokens.ts';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, absolute (no sliding renewal)
export const SESSION_COOKIE_NAME = 'cf_session';

export class InvalidCredentialsError extends Error {
  readonly statusCode = 401;
  readonly code = 'INVALID_CREDENTIALS';
  constructor() {
    // One message for unknown email AND wrong password — no user enumeration.
    super('invalid email or password');
  }
}

export interface LoginResult {
  user: User;
  /** Raw session token — cookie-bound by the route, never stored or logged. */
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedSession {
  user: User;
  session: Session;
}

export interface AuthService {
  /**
   * Verifies credentials and creates a fresh session (rotation: a valid
   * session presented on the login request is deleted — insert new + delete
   * old, never update-in-place). Also sweeps expired rows: login is the
   * single user's natural heartbeat, so no background timer exists.
   */
  login(input: {
    email: string;
    password: string;
    presentedToken?: string | undefined;
  }): Promise<LoginResult>;
  /** Resolves a raw cookie token to its user; lazily deletes an expired row. */
  validateSession(token: string): Promise<AuthenticatedSession | undefined>;
  /** Revokes the presented session; idempotent. */
  logout(token: string): Promise<void>;
}

export async function createAuthService(deps: {
  users: UsersRepository;
  sessions: SessionsRepository;
  passwords: Passwords;
  now?: () => Date;
}): Promise<AuthService> {
  const { users, sessions, passwords, now = () => new Date() } = deps;

  // Unknown-email logins verify against this throwaway hash so both failure
  // paths pay one argon2 verification — comparable timing, no enumeration.
  const dummyHash = await passwords.hashPassword(generateSessionToken());

  return {
    async login({ email, password, presentedToken }) {
      const user = await users.findByEmail(email);
      const matched = await passwords.verifyPassword(user?.passwordHash ?? dummyHash, password);
      if (!user || !matched) throw new InvalidCredentialsError();

      if (presentedToken) {
        await sessions.deleteByTokenHash(hashSessionToken(presentedToken));
      }
      await sessions.deleteExpired(now());

      const token = generateSessionToken();
      const expiresAt = new Date(now().getTime() + SESSION_TTL_MS);
      await sessions.create({ userId: user.id, tokenHash: hashSessionToken(token), expiresAt });
      return { user, token, expiresAt };
    },

    async validateSession(token) {
      const session = await sessions.findByTokenHash(hashSessionToken(token));
      if (!session) return undefined;
      if (session.expiresAt.getTime() <= now().getTime()) {
        await sessions.deleteByTokenHash(session.tokenHash);
        return undefined;
      }
      const user = await users.findById(session.userId);
      if (!user) return undefined;
      return { user, session };
    },

    async logout(token) {
      await sessions.deleteByTokenHash(hashSessionToken(token));
    },
  };
}
