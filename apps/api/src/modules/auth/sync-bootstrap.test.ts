// Integration tests for applying a rotated AUTH_BOOTSTRAP_PASSWORD.
// Credentials are fictional — the real env user never appears in any test
// (ADR-0007). Every path additionally asserts the result carries no password
// value: this module's outputs are what the CLI prints.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSessionsRepository, createUsersRepository } from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { passwords } from './passwords.ts';
import { syncBootstrapPassword } from './sync-bootstrap.ts';

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const sessions = createSessionsRepository(handle.db);

const OLD_PASSWORD = 'fictional-old-bootstrap-password';
const ENV = {
  AUTH_BOOTSTRAP_EMAIL: 'env.bootstrap.fictional@example.com',
  AUTH_BOOTSTRAP_PASSWORD: 'fictional-new-bootstrap-password',
};

function expectNoPasswordValues(result: unknown) {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(OLD_PASSWORD);
  expect(serialized).not.toContain(ENV.AUTH_BOOTSTRAP_PASSWORD);
}

async function createBootstrapUser(password: string) {
  return users.create({
    email: ENV.AUTH_BOOTSTRAP_EMAIL,
    passwordHash: await passwords.hashPassword(password),
  });
}

beforeEach(async () => {
  await truncateAllTables(handle);
});
afterAll(async () => {
  await handle.pool.end();
});

describe('syncBootstrapPassword', () => {
  it('rotates a stale hash and revokes every session for the user', async () => {
    const user = await createBootstrapUser(OLD_PASSWORD);
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    await sessions.create({ userId: user.id, tokenHash: 'fake-hash-1', expiresAt: inAnHour });
    await sessions.create({ userId: user.id, tokenHash: 'fake-hash-2', expiresAt: inAnHour });

    const result = await syncBootstrapPassword({ users, passwords, env: ENV });

    expect(result).toEqual({ status: 'rotated', userId: user.id, sessionsRevoked: 2 });
    expectNoPasswordValues(result);

    const updated = await users.findById(user.id);
    expect(updated).toBeDefined();
    expect(await passwords.verifyPassword(updated!.passwordHash, ENV.AUTH_BOOTSTRAP_PASSWORD)).toBe(
      true,
    );
    expect(await passwords.verifyPassword(updated!.passwordHash, OLD_PASSWORD)).toBe(false);
    expect(await sessions.findByTokenHash('fake-hash-1')).toBeUndefined();
    expect(await sessions.findByTokenHash('fake-hash-2')).toBeUndefined();
  });

  it('is an idempotent no-op when the hash already matches', async () => {
    const user = await createBootstrapUser(ENV.AUTH_BOOTSTRAP_PASSWORD);
    const before = (await users.findById(user.id))!.passwordHash;
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    await sessions.create({ userId: user.id, tokenHash: 'fake-hash-1', expiresAt: inAnHour });

    const result = await syncBootstrapPassword({ users, passwords, env: ENV });

    expect(result).toEqual({ status: 'already-synced', userId: user.id });
    expectNoPasswordValues(result);
    // No rewrite (same encoded hash, not merely a verifying one) and the
    // existing session survives — a no-op must not log anyone out.
    expect((await users.findById(user.id))!.passwordHash).toBe(before);
    expect(await sessions.findByTokenHash('fake-hash-1')).toBeDefined();
  });

  it('reports a missing bootstrap user without creating one', async () => {
    const result = await syncBootstrapPassword({ users, passwords, env: ENV });

    expect(result).toEqual({ status: 'user-missing' });
    expectNoPasswordValues(result);
    expect(await users.findByEmail(ENV.AUTH_BOOTSTRAP_EMAIL)).toBeUndefined();
  });
});
