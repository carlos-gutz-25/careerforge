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

// ---------------------------------------------------------------------------
// Fit engine vocabularies (M1-09, ARCHITECTURE §3 fit_reports/fit_sub_scores/
// evidence_links). Deterministic scoring only — nothing here is LLM-derived.

/** The seven sub-score dimensions, ERD order. */
export const FIT_DIMENSIONS = [
  'min_quals',
  'technical',
  'domain',
  'seniority',
  'comp_location',
  'priority',
  'stretch',
] as const;
export const fitDimensionSchema = z.enum(FIT_DIMENSIONS);
export type FitDimension = z.infer<typeof fitDimensionSchema>;

/**
 * `excluded` = at least one hard filter fired on affirmative, quote-citable
 * evidence (M1-08 domain law: an explicit exclusion verdict, never a silent
 * low score). Sub-scores are still computed for an excluded report — the
 * verdict dominates presentation, the breakdown stays informative.
 */
export const FIT_VERDICTS = ['scored', 'excluded'] as const;
export const fitVerdictSchema = z.enum(FIT_VERDICTS);
export type FitVerdict = z.infer<typeof fitVerdictSchema>;

/**
 * Evidence-link strength: `direct` = named profile skill at level
 * expert|solid; `partial` = named profile skill at level rusty|learning;
 * `adjacent` = evidence found only in experience/project text, not a named
 * skill.
 */
export const EVIDENCE_STRENGTHS = ['direct', 'partial', 'adjacent'] as const;
export const evidenceStrengthSchema = z.enum(EVIDENCE_STRENGTHS);
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;

/** Fit reports are draft-until-reviewed (CLAUDE.md law), like every generated
 *  artifact — deterministic provenance does not skip review. */
export const FIT_REVIEW_STATUSES = ['draft', 'reviewed'] as const;
export const fitReviewStatusSchema = z.enum(FIT_REVIEW_STATUSES);
export type FitReviewStatus = z.infer<typeof fitReviewStatusSchema>;

/**
 * Why a requirement row was ineligible for scoring, by its quoteVerified
 * verification state (M1-06 tristate): `failed_verification` = false (the
 * stored quote does not verbatim-match its posting), `not_yet_verified` =
 * NULL (verification has not run — pre-backfill rows). Both are excluded
 * from every sub-score numerator AND denominator and surfaced on the report;
 * only true is eligible (pre-registered, M1-09 D3).
 */
export const UNSCORED_REQUIREMENT_REASONS = ['failed_verification', 'not_yet_verified'] as const;
export const unscoredRequirementReasonSchema = z.enum(UNSCORED_REQUIREMENT_REASONS);
export type UnscoredRequirementReason = z.infer<typeof unscoredRequirementReasonSchema>;

// ---------------------------------------------------------------------------
// Gap classification vocabularies (M1-11, ARCHITECTURE §3 gaps). These are
// CLASSIFICATIONS — "verdict" stays reserved for scored|excluded (the
// vocabulary law). Deterministic rules only (packages/scoring); nothing here
// is LLM-derived.

/**
 * The five buckets, ERD/AC order. Ladder PRECEDENCE (first match wins) is the
 * classification rules' spec in packages/scoring: have ->
 * have_undemonstrated -> needs_refresh -> low_priority -> genuine_gap.
 */
export const GAP_CLASSIFICATIONS = [
  'have',
  'have_undemonstrated',
  'needs_refresh',
  'genuine_gap',
  'low_priority',
] as const;
export const gapClassificationSchema = z.enum(GAP_CLASSIFICATIONS);
export type GapClassification = z.infer<typeof gapClassificationSchema>;

/**
 * How a carried override arrived on a gap row (M1-11 D5): `requirement_id` =
 * carried across a re-score (same run, same requirement ids); `content` =
 * carried across a re-extraction by a one-to-one whitespace-normalized text
 * match. NULL at rest = fresh engine assignment or a direct user PATCH. The
 * carry source is always the posting's immediately prior report (A1 — never
 * older history, so an un-override can never be resurrected).
 */
export const GAP_CARRIED_VIA = ['requirement_id', 'content'] as const;
export const gapCarriedViaSchema = z.enum(GAP_CARRIED_VIA);
export type GapCarriedVia = z.infer<typeof gapCarriedViaSchema>;

// ---------------------------------------------------------------------------
// Improvement plan vocabularies (M1-12, ARCHITECTURE §3 improvement_plans /
// plan_items / improvement_plan_runs). The plan is LLM-DRAFTED (the first
// drafting consumer, ADR-0005 §3: verified structured data only) and
// draft-until-reviewed like every generated artifact.

/**
 * Values match FIT_REVIEW_STATUSES today; a separate named const so the two
 * review workflows can evolve independently (M1-12 gate, §1 delta 8).
 */
export const PLAN_REVIEW_STATUSES = ['draft', 'reviewed'] as const;
export const planReviewStatusSchema = z.enum(PLAN_REVIEW_STATUSES);
export type PlanReviewStatus = z.infer<typeof planReviewStatusSchema>;

/** Model-assigned per item, user-editable after (full-replacement PATCH). */
export const PLAN_ITEM_PRIORITIES = ['high', 'medium', 'low'] as const;
export const planItemPrioritySchema = z.enum(PLAN_ITEM_PRIORITIES);
export type PlanItemPriority = z.infer<typeof planItemPrioritySchema>;

/**
 * Item execution lifecycle. `planned | in_progress | complete` matches the
 * drawn exercises.status family (ARCHITECTURE §3) so sibling artifact tables
 * share one terminal vocabulary when M3-02 lands (M1-12 gate A1); `dropped` =
 * the honest "I won't do this" — never a silent deletion.
 */
export const PLAN_ITEM_STATUSES = ['planned', 'in_progress', 'complete', 'dropped'] as const;
export const planItemStatusSchema = z.enum(PLAN_ITEM_STATUSES);
export type PlanItemStatus = z.infer<typeof planItemStatusSchema>;

/**
 * `ok | schema_failed | refusal | max_tokens | error` are set by the LLM
 * runner (one row per wire call, the M1-05 law applied to a second call
 * site); `flagged` is applied post-hoc by CITATION validation — the drafting
 * analog of ADR-0006 layer 4: the model cited a gap ref that was never sent
 * — and is NEVER set by the runner. Values identical to
 * EXTRACTION_RUN_STATUSES today; separate const by the same rule as
 * PLAN_REVIEW_STATUSES.
 */
export const PLAN_DRAFTING_RUN_STATUSES = [
  'ok',
  'schema_failed',
  'refusal',
  'max_tokens',
  'error',
  'flagged',
] as const;
export const planDraftingRunStatusSchema = z.enum(PLAN_DRAFTING_RUN_STATUSES);
export type PlanDraftingRunStatus = z.infer<typeof planDraftingRunStatusSchema>;
