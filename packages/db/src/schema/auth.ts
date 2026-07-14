import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from './helpers.ts';

export const users = pgTable('users', {
  id: id(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  ...timestamps(),
});

// Not in the ERD (added by M0-06, ARCHITECTURE §3 amended): minimal shape for
// M0-07 session auth. Only the SHA-256 of the session token is stored — the
// raw token exists solely in the cookie. Rotation = insert new + delete old.
export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text().notNull().unique('sessions_token_hash_unique'),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  ...timestamps(),
});
