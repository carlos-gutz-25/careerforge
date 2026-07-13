import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { createSessionsRepository } from './sessions.repository.ts';
import { createUsersRepository, type User } from './users.repository.ts';

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const repo = createSessionsRepository(handle.db);

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);
const oneHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

let alex: User;
beforeEach(async () => {
  await truncateAllTables(handle);
  alex = await users.create({
    email: 'alex.rivera.example@example.com',
    passwordHash: 'fake-hash-not-a-real-credential',
  });
});
afterAll(() => handle.pool.end());

describe('SessionsRepository (integration)', () => {
  it('creates a session and finds it by token hash', async () => {
    const created = await repo.create({
      userId: alex.id,
      tokenHash: 'sha256-of-a-fictional-token',
      expiresAt: inOneHour(),
    });
    const found = await repo.findByTokenHash('sha256-of-a-fictional-token');
    expect(found).toEqual(created);
    expect(found?.userId).toBe(alex.id);
  });

  it('deletes by token hash (logout)', async () => {
    await repo.create({ userId: alex.id, tokenHash: 'hash-a', expiresAt: inOneHour() });
    await repo.deleteByTokenHash('hash-a');
    expect(await repo.findByTokenHash('hash-a')).toBeUndefined();
  });

  it('deleteExpired removes only past-expiry sessions and reports the count', async () => {
    await repo.create({ userId: alex.id, tokenHash: 'hash-live', expiresAt: inOneHour() });
    await repo.create({ userId: alex.id, tokenHash: 'hash-stale', expiresAt: oneHourAgo() });
    expect(await repo.deleteExpired(new Date())).toBe(1);
    expect(await repo.findByTokenHash('hash-stale')).toBeUndefined();
    expect(await repo.findByTokenHash('hash-live')).toBeDefined();
  });
});
