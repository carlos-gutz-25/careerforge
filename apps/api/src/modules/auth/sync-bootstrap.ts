import { type UsersRepository } from '@careerforge/db';

import { type Env } from '../../env.ts';
import { type Passwords } from './passwords.ts';

export type SyncBootstrapResult =
  | { status: 'user-missing' }
  | { status: 'already-synced'; userId: string }
  | { status: 'rotated'; userId: string; sessionsRevoked: number };

/**
 * Applies a changed AUTH_BOOTSTRAP_PASSWORD to the already-created bootstrap
 * user — the counterpart to ensureBootstrapUser, which is create-if-absent
 * and deliberately never updates (M0-07). Re-hashes with the module's pinned
 * argon2id parameters and revokes every session for the user in the same
 * transaction (a rotated credential must invalidate live capabilities).
 *
 * Idempotent: if the stored hash already verifies against the env password,
 * nothing is written. The password value never appears in results, errors,
 * or logs — callers report status and counts only.
 */
export async function syncBootstrapPassword(deps: {
  users: UsersRepository;
  passwords: Passwords;
  env: Pick<Env, 'AUTH_BOOTSTRAP_EMAIL' | 'AUTH_BOOTSTRAP_PASSWORD'>;
}): Promise<SyncBootstrapResult> {
  const { users, passwords, env } = deps;

  const existing = await users.findByEmail(env.AUTH_BOOTSTRAP_EMAIL);
  if (!existing) return { status: 'user-missing' };

  if (await passwords.verifyPassword(existing.passwordHash, env.AUTH_BOOTSTRAP_PASSWORD)) {
    return { status: 'already-synced', userId: existing.id };
  }

  const { sessionsRevoked } = await users.rotatePasswordHash(
    existing.id,
    await passwords.hashPassword(env.AUTH_BOOTSTRAP_PASSWORD),
  );
  return { status: 'rotated', userId: existing.id, sessionsRevoked };
}
