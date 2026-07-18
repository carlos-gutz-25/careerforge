import { MODULE_ID as CORE_MODULE_ID } from '@careerforge/core';

export const MODULE_ID = '@careerforge/db';
export const INTERNAL_DEPENDENCIES = [CORE_MODULE_ID];

export * from './schema/index.ts';
export { createDb, type Db, type DbHandle } from './client.ts';
export { isConnectionRefused, postgresUnreachableMessage, runMigrations } from './migrate.ts';
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
export {
  createProfileRepository,
  type ProfileData,
  type ProfileExperience,
  type ProfileImportData,
  type ProfileImportExperience,
  type ProfileImportProject,
  type ProfileImportSkill,
  type ProfileProject,
  type ProfileRepository,
  type ProfileSkill,
  type ProfileSyncSummary,
  type SyncCounts,
} from './repositories/profile.repository.ts';
export {
  createSearchCriteriaRepository,
  type SearchCriteriaRepository,
  type SearchCriteriaRow,
} from './repositories/criteria.repository.ts';
export {
  createApplicationsRepository,
  type ApplicationEventInsert,
  type ApplicationEventRow,
  type ApplicationRow,
  type ApplicationsRepository,
  type ApplicationWithPostingRow,
} from './repositories/applications.repository.ts';
export {
  createPostingsRepository,
  type JobPosting,
  type JobPostingMeta,
  type PostingIngestData,
  type PostingsRepository,
} from './repositories/postings.repository.ts';
export {
  createExtractionsRepository,
  deriveRunStatus,
  type ExtractionOutcome,
  type ExtractionRunInsert,
  type ExtractionRunRow,
  type ExtractionsRepository,
  type QuoteVerdict,
  type RequirementInsert,
  type RequirementRow,
  type RunWithRequirements,
  type UnverifiedRunBatch,
} from './repositories/extractions.repository.ts';
export { seed, SEED_USER_EMAIL } from './seed.ts';
