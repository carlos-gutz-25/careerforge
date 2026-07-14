import { type FastifyBaseLogger } from 'fastify';
import { type User, type UsersRepository } from '@careerforge/db';

import { type Env } from '../../env.ts';
import { type Passwords } from './passwords.ts';

/**
 * Creates the single user from env at first boot (ADR-0007: no registration
 * flow). "First boot" = no user with AUTH_BOOTSTRAP_EMAIL exists — the seeded
 * example profile doesn't count and can never authenticate. Idempotent on
 * every subsequent boot. Called from main.ts only, never buildApp, so tests
 * always create their own fictional users instead.
 *
 * The password exists only in .env and process memory: never logged, never
 * in a fixture. Log lines carry the user id only.
 */
export async function ensureBootstrapUser(deps: {
  users: UsersRepository;
  passwords: Passwords;
  env: Pick<Env, 'AUTH_BOOTSTRAP_EMAIL' | 'AUTH_BOOTSTRAP_PASSWORD'>;
  log: FastifyBaseLogger;
}): Promise<User> {
  const { users, passwords, env, log } = deps;

  const existing = await users.findByEmail(env.AUTH_BOOTSTRAP_EMAIL);
  if (existing) {
    log.info(
      { userId: existing.id },
      'bootstrap user exists; AUTH_BOOTSTRAP_PASSWORD changes do NOT update it',
    );
    return existing;
  }

  const created = await users.create({
    email: env.AUTH_BOOTSTRAP_EMAIL,
    passwordHash: await passwords.hashPassword(env.AUTH_BOOTSTRAP_PASSWORD),
  });
  log.info({ userId: created.id }, 'bootstrap user created from env');
  return created;
}
