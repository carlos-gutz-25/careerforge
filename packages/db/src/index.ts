import { MODULE_ID as CORE_MODULE_ID } from '@careerforge/core';

export const MODULE_ID = '@careerforge/db';
export const INTERNAL_DEPENDENCIES = [CORE_MODULE_ID];

export * from './schema/index.ts';
export { createDb, type Db, type DbHandle } from './client.ts';
export { checkDbReady } from './readiness.ts';
export { isConnectionRefused, postgresUnreachableMessage, runMigrations } from './migrate.ts';
export {
  assertNoMigrationDrift,
  checkMigrationDrift,
  describeMigrationDrift,
  MigrationDriftError,
  type MigrationDriftResult,
} from './migration-drift.ts';
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
  type ProfileCounts,
  type ProfileData,
  type ProfileExperience,
  type ProfileExperienceBullet,
  type ProfileExperienceWithBullets,
  type ProfileImportContact,
  type ProfileImportData,
  type ProfileImportEducation,
  type ProfileImportExperience,
  type ProfileImportProject,
  type ProfileImportSkill,
  type ProfileImportSummaryBlock,
  type ProfileProject,
  type ProfileRepository,
  type ProfileSkill,
  type ProfileSkillEffective,
  type ProfileSyncSummary,
  type SyncCounts,
} from './repositories/profile.repository.ts';
export {
  createSearchCriteriaRepository,
  type SearchCriteriaRepository,
  type SearchCriteriaRow,
} from './repositories/criteria.repository.ts';
export {
  createProfileFactsRepository,
  type FactsSyncSummary,
  type ProfileFactImport,
  type ProfileFactRow,
  type ProfileFactsRepository,
} from './repositories/profile-facts.repository.ts';
export {
  createCriteriaAdjustmentsRepository,
  type ConfirmAdjustmentInput,
  type ConfirmAdjustmentResult,
  type CriteriaAdjustmentRow,
  type CriteriaAdjustmentsRepository,
} from './repositories/criteria-adjustments.repository.ts';
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
export {
  createFitReportsRepository,
  type EvidenceLinkRow,
  type FitPersistOutcome,
  type FitReportRow,
  type FitReportsRepository,
  type FitReportWithSubScores,
  type FitSubScoreRow,
  type FitSubScoreWithEvidence,
  type GapRow,
} from './repositories/fit-reports.repository.ts';
export {
  createGapsRepository,
  type GapForSelection,
  type GapRequirement,
  type GapRequirementRead,
  type GapsForReport,
  type GapsRepository,
  type GapWithRequirement,
  type MarketSignalCohortCounts,
  type MarketSignalRow,
} from './repositories/gaps.repository.ts';
export {
  createLearningPlansRepository,
  type LearningDraftingPersistOutcome,
  type LearningEvidenceRow,
  type LearningPlanGapInsert,
  type LearningPlanPointer,
  type LearningPlanPointerRead,
  type LearningPlanGapRow,
  type LearningPlanGapWithGap,
  type LearningPlanInsert,
  type LearningPlanReviewOutcome,
  type LearningPlanRow,
  type LearningPlanRunInsert,
  type LearningPlanRunRow,
  type LearningPlansRepository,
  type LearningPlanSummaryRow,
  type LearningPlanWithGaps,
} from './repositories/learning-plans.repository.ts';
export {
  createExercisesRepository,
  type CompletedExercise,
  type CreateExerciseInput,
  type ExerciseCaseStudyRead,
  type ExerciseDemoBlueprintRead,
  type ExerciseOwnershipRead,
  type ExerciseReviewRead,
  type ExerciseRow,
  type ExercisesRepository,
  type ExerciseUpgradeRead,
  type ExerciseWithGaps,
} from './repositories/exercises.repository.ts';
export {
  createMasteryEvidenceRepository,
  type CreateMasteryEvidenceInput,
  type EvidenceKindCounts,
  type MasteryEvidenceEmbedRead,
  type MasteryEvidenceGateRead,
  type MasteryEvidenceRepository,
  type MasteryEvidenceRow,
} from './repositories/mastery-evidence.repository.ts';
export {
  createImprovementPlansRepository,
  derivePlanRunStatus,
  type DraftingEvidenceRow,
  type DraftingPersistOutcome,
  type ImprovementPlanRow,
  type ImprovementPlanRunRow,
  type ImprovementPlansRepository,
  type PlanDraftingRunInsert,
  type PlanItemInsert,
  type PlanItemRecommendationInsert,
  type PlanItemRecommendationRow,
  type PlanItemRow,
  type PlanItemWithGap,
  type PlanReviewOutcome,
  type PlanWithItems,
} from './repositories/improvement-plans.repository.ts';
export {
  createResumeVariantsRepository,
  deriveResumeRunStatus,
  type CitationWithGap,
  type ResumeVariantCitationRow,
  type ResumeVariantEntryInsert,
  type ResumeVariantEntryRow,
  type ResumeVariantInsert,
  type ResumeVariantRow,
  type ResumeVariantRunInsert,
  type ResumeVariantRunRow,
  type ResumeVariantsRepository,
  type TailoringEvidenceRow,
  type TailoringPersistOutcome,
  type VariantEntryWithCitations,
  type VariantReviewOutcome,
  type VariantWithEntries,
} from './repositories/resume-variants.repository.ts';
export {
  createResumeDocumentsRepository,
  deriveComposeRunStatus,
  type ClaimWithCitations,
  type ComposeCitationInsert,
  type ComposeClaimInsert,
  type ComposeDocumentInsert,
  type ComposeInputContact,
  type ComposeInputEducation,
  type ComposeInputExperience,
  type ComposeInputGuidance,
  type ComposeInputProject,
  type ComposeInputSkill,
  type ComposeInputSummary,
  type ComposeInputs,
  type ComposePersistOutcome,
  type ComposeRunInsert,
  type DocumentReviewOutcome,
  type DocumentWithClaims,
  type ResumeClaimCitationRow,
  type ResumeClaimRow,
  type ResumeComposeRunRow,
  type ResumeDocumentRow,
  type ResumeDocumentsRepository,
  type SupersedeOutcome,
} from './repositories/resume-documents.repository.ts';
export {
  createInterviewPrepsRepository,
  deriveInterviewRunStatus,
  type InterviewEvidenceRow,
  type InterviewPersistOutcome,
  type InterviewPointInsert,
  type InterviewPointWithDisplay,
  type InterviewPrepPointRow,
  type InterviewPrepQuestionRow,
  type InterviewPrepReviewOutcome,
  type InterviewPrepRow,
  type InterviewPrepRunInsert,
  type InterviewPrepRunRow,
  type InterviewPrepsRepository,
  type InterviewQuestionInsert,
  type InterviewQuestionWithPoints,
  type InterviewRequirementRow,
  type PrepWithQuestions,
} from './repositories/interview-preps.repository.ts';
export {
  createApplicationGameplansRepository,
  deriveGameplanRunStatus,
  type ApplicationGameplanRow,
  type ApplicationGameplansRepository,
  type GameplanArtifactInsert,
  type GameplanCheckRow,
  type GameplanEvidenceRow,
  type GameplanImprovementPlanGuidance,
  type GameplanPersistOutcome,
  type GameplanPhaseStrategyRow,
  type GameplanRequirementRow,
  type GameplanReviewOutcome,
  type GameplanRunInsert,
  type GameplanRunRow,
  type GameplanSiblingPointerRow,
  type GameplanSiblingPointers,
  type GameplanStageChangeRow,
  type GameplanStoryCitationRow,
  type GameplanStoryCitationWithDisplay,
  type GameplanStoryInsert,
  type GameplanStoryRow,
  type GameplanStoryWithCitations,
  type GameplanWithChildren,
} from './repositories/application-gameplans.repository.ts';
export {
  createSkillUpgradesRepository,
  type CreateSkillUpgradeEvidenceInput,
  type CreateSkillUpgradeInput,
  type RevokeOutcome,
  type SkillUpgradeEvidenceRow,
  type SkillUpgradeRow,
  type SkillUpgradesRepository,
  type SkillUpgradeWithEvidence,
} from './repositories/skill-upgrades.repository.ts';
export {
  createCaseStudiesRepository,
  type CaseStudiesRepository,
  type CaseStudyDraftInput,
  type CaseStudyRow,
  type CreateCaseStudyInput,
  type PublishOutcome,
} from './repositories/case-studies.repository.ts';
export {
  createDemoBlueprintsRepository,
  type DemoBlueprintRow,
  type DemoBlueprintSnapshot,
  type DemoBlueprintsRepository,
} from './repositories/demo-blueprints.repository.ts';
export {
  createDemoSeedStateRepository,
  type DemoSeedMarker,
  type DemoSeedStateRow,
  type DemoSeedStateRepository,
} from './repositories/demo-seed-state.repository.ts';
export { pgErrorCode } from './pg-errors.ts';
export { seed, SEED_USER_EMAIL } from './seed.ts';
