import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { createSessionsRepository } from './sessions.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Fictional fixture data only (docs/profile.example/, RISKS P-01).
const ALEX = {
  email: 'alex.rivera.example@example.com',
  passwordHash: 'fake-hash-not-a-real-credential',
};

const handle = createTestDb();
const repo = createUsersRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

describe('UsersRepository (integration)', () => {
  it('creates a user with DB-generated id and timestamps', async () => {
    const created = await repo.create(ALEX);
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(created.email).toBe(ALEX.email);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it('finds by email and by id', async () => {
    const created = await repo.create(ALEX);
    expect(await repo.findByEmail(ALEX.email)).toEqual(created);
    expect(await repo.findById(created.id)).toEqual(created);
  });

  it('returns undefined for unknown lookups', async () => {
    expect(await repo.findByEmail('nobody@example.com')).toBeUndefined();
    expect(await repo.findById('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  it('rejects a duplicate email (users_email_unique)', async () => {
    await repo.create(ALEX);
    await expect(repo.create(ALEX)).rejects.toSatisfy(
      (error) => pgErrorCode(error) === '23505',
      'expected unique_violation',
    );
  });

  describe('rotatePasswordHash', () => {
    const sessionsRepo = createSessionsRepository(handle.db);
    const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

    it('updates the hash and revokes all of the user’s sessions, and only theirs', async () => {
      const alex = await repo.create(ALEX);
      const other = await repo.create({
        email: 'sam.jordan.example@example.com',
        passwordHash: 'another-fake-hash',
      });
      await sessionsRepo.create({ userId: alex.id, tokenHash: 'hash-a1', expiresAt: inAnHour() });
      await sessionsRepo.create({ userId: alex.id, tokenHash: 'hash-a2', expiresAt: inAnHour() });
      await sessionsRepo.create({ userId: other.id, tokenHash: 'hash-b1', expiresAt: inAnHour() });

      const result = await repo.rotatePasswordHash(alex.id, 'rotated-fake-hash');

      expect(result).toEqual({ sessionsRevoked: 2 });
      expect((await repo.findById(alex.id))?.passwordHash).toBe('rotated-fake-hash');
      expect(await sessionsRepo.findByTokenHash('hash-a1')).toBeUndefined();
      expect(await sessionsRepo.findByTokenHash('hash-a2')).toBeUndefined();
      expect(await sessionsRepo.findByTokenHash('hash-b1')).toBeDefined();
      expect((await repo.findById(other.id))?.passwordHash).toBe('another-fake-hash');
    });

    it('is a plain update when the user has no sessions', async () => {
      const alex = await repo.create(ALEX);
      const result = await repo.rotatePasswordHash(alex.id, 'rotated-fake-hash');
      expect(result).toEqual({ sessionsRevoked: 0 });
    });

    it('throws for an unknown user', async () => {
      await expect(
        repo.rotatePasswordHash('00000000-0000-4000-8000-000000000000', 'rotated-fake-hash'),
      ).rejects.toThrow('user not found');
    });
  });
});
