import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
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
});
