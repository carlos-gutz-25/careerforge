import { eq, lt } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { sessions } from '../schema/auth.ts';

export type Session = typeof sessions.$inferSelect;

// Lookups key on token_hash — the hash IS the credential (per-user filtering
// per ADR-0007 doesn't apply to a table whose lookup key proves ownership).
export interface SessionsRepository {
  create(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<Session>;
  findByTokenHash(tokenHash: string): Promise<Session | undefined>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  /** Returns the number of sessions removed. */
  deleteExpired(now: Date): Promise<number>;
}

export function createSessionsRepository(db: Db): SessionsRepository {
  return {
    async create(input) {
      const [row] = await db.insert(sessions).values(input).returning();
      if (!row) throw new Error('sessions insert returned no row');
      return row;
    },
    async findByTokenHash(tokenHash) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      return row;
    },
    async deleteByTokenHash(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
    async deleteExpired(now) {
      const deleted = await db
        .delete(sessions)
        .where(lt(sessions.expiresAt, now))
        .returning({ id: sessions.id });
      return deleted.length;
    },
  };
}
