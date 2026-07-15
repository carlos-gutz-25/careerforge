import { eq } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { sessions, users } from '../schema/auth.ts';

export type User = typeof users.$inferSelect;

export interface UsersRepository {
  create(input: { email: string; passwordHash: string }): Promise<User>;
  findByEmail(email: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
  /**
   * Updates the user's password hash and revokes ALL their sessions in one
   * transaction — a rotated credential must invalidate live capabilities.
   * Throws if the user does not exist.
   */
  rotatePasswordHash(userId: string, passwordHash: string): Promise<{ sessionsRevoked: number }>;
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
    rotatePasswordHash(userId, passwordHash) {
      return db.transaction(async (tx) => {
        const [updated] = await tx
          .update(users)
          .set({ passwordHash })
          .where(eq(users.id, userId))
          .returning({ id: users.id });
        if (!updated) throw new Error('rotatePasswordHash: user not found');
        const revoked = await tx
          .delete(sessions)
          .where(eq(sessions.userId, userId))
          .returning({ id: sessions.id });
        return { sessionsRevoked: revoked.length };
      });
    },
  };
}
