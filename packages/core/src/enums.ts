import { z } from 'zod';

// Canonical enum-like value sets for schema v1 (ARCHITECTURE.md §3 ERD).
// Plain `as const` arrays — TS enums are banned (not erasable under Node's
// type stripping). packages/db derives both the Drizzle column types and the
// SQL CHECK constraints from these, so DB and app can never disagree.

export const SKILL_LEVELS = ['expert', 'solid', 'rusty', 'learning'] as const;
export const skillLevelSchema = z.enum(SKILL_LEVELS);
export type SkillLevel = z.infer<typeof skillLevelSchema>;

export const PROJECT_PROVENANCES = ['professional', 'personal', 'personal_ai_assisted'] as const;
export const projectProvenanceSchema = z.enum(PROJECT_PROVENANCES);
export type ProjectProvenance = z.infer<typeof projectProvenanceSchema>;

export const JOB_POSTING_STATUSES = ['new', 'extracted', 'scored', 'archived'] as const;
export const jobPostingStatusSchema = z.enum(JOB_POSTING_STATUSES);
export type JobPostingStatus = z.infer<typeof jobPostingStatusSchema>;

export const APPLICATION_STAGES = [
  'considering',
  'applied',
  'screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const;
export const applicationStageSchema = z.enum(APPLICATION_STAGES);
export type ApplicationStage = z.infer<typeof applicationStageSchema>;

export const APPLICATION_EVENT_KINDS = ['stage_change', 'note', 'outcome'] as const;
export const applicationEventKindSchema = z.enum(APPLICATION_EVENT_KINDS);
export type ApplicationEventKind = z.infer<typeof applicationEventKindSchema>;

/**
 * `ok | schema_failed | refusal | max_tokens | error` are set by the LLM
 * runner (packages/llm LlmCallStatus — one row per wire call, M1-05);
 * `flagged` is applied post-hoc by evidence verification (M1-06) and is
 * NEVER set by the runner. The DB CHECK admits the full vocabulary from
 * day one so M1-06 needs no migration.
 */
export const EXTRACTION_RUN_STATUSES = [
  'ok',
  'schema_failed',
  'refusal',
  'max_tokens',
  'error',
  'flagged',
] as const;
export const extractionRunStatusSchema = z.enum(EXTRACTION_RUN_STATUSES);
export type ExtractionRunStatus = z.infer<typeof extractionRunStatusSchema>;

/**
 * The statuses under which a run row has committed requirement artifacts:
 * `ok` (verified clean) and `flagged` (committed, but ≥1 quote failed
 * evidence verification — human review, not absence). The extract cache
 * read, the GET requirements path, and the artifact-derived unarchive law
 * all key on this set — a flagged run must stay served, or flipping a run
 * would silently vanish it (M1-06).
 */
export const REQUIREMENT_BEARING_STATUSES = [
  'ok',
  'flagged',
] as const satisfies readonly ExtractionRunStatus[];

export const REQUIREMENT_KINDS = ['must_have', 'nice_to_have'] as const;
export const requirementKindSchema = z.enum(REQUIREMENT_KINDS);
export type RequirementKind = z.infer<typeof requirementKindSchema>;

export const REQUIREMENT_CATEGORIES = [
  'language',
  'framework',
  'domain',
  'seniority',
  'comp',
  'location',
  'other',
] as const;
export const requirementCategorySchema = z.enum(REQUIREMENT_CATEGORIES);
export type RequirementCategory = z.infer<typeof requirementCategorySchema>;
