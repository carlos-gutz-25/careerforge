import { MODULE_ID as CORE_MODULE_ID } from '@careerforge/core';

export const MODULE_ID = '@careerforge/db';
export const INTERNAL_DEPENDENCIES = [CORE_MODULE_ID];

export * from './schema/index.ts';
export { createDb, type Db, type DbHandle } from './client.ts';
export { runMigrations } from './migrate.ts';
export {
  createUsersRepository,
  type User,
  type UsersRepository,
} from './repositories/users.repository.ts';
export {
  createSessionsRepository,
  type Session,
  type SessionsRepository,
} from './repositories/sessions.repository.ts';
