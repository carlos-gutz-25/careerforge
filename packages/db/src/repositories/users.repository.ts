import { eq } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { users } from '../schema/auth.ts';

export type User = typeof users.$inferSelect;

export interface UsersRepository {
  create(input: { email: string; passwordHash: string }): Promise<User>;
  findByEmail(email: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
}

export function createUsersRepository(db: Db): UsersRepository {
  return {
    async create(input) {
      const [row] = await db.insert(users).values(input).returning();
      if (!row) throw new Error('users insert returned no row');
      return row;
    },
    async findByEmail(email) {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return row;
    },
    async findById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row;
    },
  };
}
