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

// ---------------------------------------------------------------------------
// Resume tailoring vocabularies (M2-10, ARCHITECTURE §3 resume_variant_runs /
// resume_variants / resume_variant_entries / resume_variant_citations). The
// tailoring SPEC is LLM-DRAFTED (the second drafting consumer, ADR-0012: the
// model emits only ordering + emphasis over server-assigned refs, never resume
// prose) and draft-until-reviewed like every generated artifact. This is a
// tailoring/emphasis guide over verified profile facts, not a bulleted resume
// (bullet-level tailoring is the additive phase-2 story M2-12).

/**
 * `ok | schema_failed | refusal | max_tokens | error` are set by the LLM
 * runner (one row per wire call, the M1-05 law applied to a third call site);
 * `flagged` is applied post-hoc by SPEC validation — the tailoring analog of
 * ADR-0006 layer 4: the model cited a ref that was never sent, or an order
 * that is not an exact permutation of the sent refs — and is NEVER set by the
 * runner. Values identical to PLAN_DRAFTING_RUN_STATUSES today; a separate
 * const by the same rule as PLAN_REVIEW_STATUSES (the two workflows evolve
 * independently).
 */
export const RESUME_VARIANT_RUN_STATUSES = [
  'ok',
  'schema_failed',
  'refusal',
  'max_tokens',
  'error',
  'flagged',
] as const;
export const resumeVariantRunStatusSchema = z.enum(RESUME_VARIANT_RUN_STATUSES);
export type ResumeVariantRunStatus = z.infer<typeof resumeVariantRunStatusSchema>;

/**
 * Values match FIT_REVIEW_STATUSES / PLAN_REVIEW_STATUSES today; a separate
 * named const so the review workflows can evolve independently. A reviewed
 * variant is the only one the export route serves (draft-until-reviewed).
 */
export const RESUME_VARIANT_REVIEW_STATUSES = ['draft', 'reviewed'] as const;
export const resumeVariantReviewStatusSchema = z.enum(RESUME_VARIANT_REVIEW_STATUSES);
export type ResumeVariantReviewStatus = z.infer<typeof resumeVariantReviewStatusSchema>;

/**
 * The three profile entity kinds a rendered variant entry can point at. The
 * model orders skills and projects; experiences are server-assigned
 * chronological order (never reordered or omitted — the ADR-0012 honesty
 * invariant, structurally unrepresentable to violate because the output schema
 * carries no experience-order field).
 */
export const RESUME_ENTITY_TYPES = ['skill', 'experience', 'project'] as const;
export const resumeEntityTypeSchema = z.enum(RESUME_ENTITY_TYPES);
export type ResumeEntityType = z.infer<typeof resumeEntityTypeSchema>;

/**
 * Emphasis strength the model may assign to an entity: `lead` = surface in the
 * highlights block; `highlight` = mark in place. NULL at the entry level (no
 * emphasis row) = standard weight. Emphasis adds only a citation marker to the
 * body — it never rewrites, drops, or reorders the underlying verified content.
 */
export const RESUME_EMPHASIS_LEVELS = ['lead', 'highlight'] as const;
export const resumeEmphasisLevelSchema = z.enum(RESUME_EMPHASIS_LEVELS);
export type ResumeEmphasisLevel = z.infer<typeof resumeEmphasisLevelSchema>;

// ---------------------------------------------------------------------------
// Exercise vocabularies (M3-02, ARCHITECTURE §3 exercises / exercise_gaps).
// An exercise is a USER-AUTHORED action to close a gap cited by a learning
// plan (M3-01) — deterministic CRUD, NOT LLM-drafted. Both value sets are
// net-new here (no prior enum reserved them); each is its own named const per
// the sibling-artifact idiom so the workflows can evolve independently.

/**
 * The four exercise shapes the user picks at creation (BACKLOG M3-02). Stored
 * as text + CHECK from this set (ADR-0003, never a pg enum); immutable after
 * create in M3-02 (a mis-created exercise is recoverable via DELETE, not a
 * kind edit).
 */
export const EXERCISE_KINDS = ['kata', 'project', 'writeup', 'interview_drill'] as const;
export const exerciseKindSchema = z.enum(EXERCISE_KINDS);
export type ExerciseKind = z.infer<typeof exerciseKindSchema>;

/**
 * Exercise execution lifecycle. Exactly `planned | in_progress | complete` as
 * drawn in the ERD (ARCHITECTURE §3) — its OWN const, NOT PLAN_ITEM_STATUSES:
 * an exercise has no `dropped` state (that is the LLM-plan-item's honest
 * "I won't do this"; a user simply DELETEs an exercise they abandon). The
 * shared three-value terminal vocabulary is the `PLAN_ITEM_STATUSES` sibling
 * comment's promise, now honored. `status` is the only field a `PATCH
 * /exercises/:id` may change.
 */
export const EXERCISE_STATUSES = ['planned', 'in_progress', 'complete'] as const;
export const exerciseStatusSchema = z.enum(EXERCISE_STATUSES);
export type ExerciseStatus = z.infer<typeof exerciseStatusSchema>;

// ---------------------------------------------------------------------------
// Mastery-evidence vocabulary (M3-03, ARCHITECTURE §3 mastery_evidence).
// A mastery-evidence row is a USER-AUTHORED record that an exercise (M3-02)
// was actually done — deterministic CRUD, NOT LLM-drafted. Net-new here (no
// prior enum reserved it), its own named const per the sibling-artifact idiom.

/**
 * How an exercise was proven: `implemented` = built it, `tested` = proved it
 * works, `explained` = taught/wrote it up, `revisited` = returned to it later
 * (M3-05 spaced review records this kind repeatedly). Stored as text + CHECK
 * from this set (ADR-0003, never a pg enum). The exercise-completion gate
 * (M3-03) requires ≥1 `implemented` AND ≥1 `tested` before an exercise may be
 * `complete` — checked for EXISTENCE, not count, so a kind may recur.
 *
 * NOT to be confused with `EVIDENCE_STRENGTHS` (direct|partial|adjacent), which
 * grades a fit-report evidence LINK (M1-09). Different axis, different table:
 * this names WHAT was done to close a learning gap; that grades HOW STRONGLY a
 * profile fact backs a job requirement.
 */
export const EVIDENCE_KINDS = ['implemented', 'tested', 'explained', 'revisited'] as const;
export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

// ---------------------------------------------------------------------------
// Interview-prep vocabularies (M3-04, ARCHITECTURE §3 interview_prep_runs /
// interview_preps / interview_prep_questions / interview_prep_points). The
// prep is LLM-DRAFTED (the fourth drafting ingress under ADR-0013's shared
// safety template) and draft-until-reviewed like every generated artifact.
// Run + review workflow vocabularies are REUSED, not re-minted:
// PLAN_DRAFTING_RUN_STATUSES / PLAN_REVIEW_STATUSES (the M3-01 precedent —
// the drafting family shares one workflow vocabulary until a workflow
// actually diverges).

/**
 * The two question shapes interview-prep@v1 may draft (M3-04 gate decision
 * (c), deliberately minimal for v1): `technical` = probes the requirement's
 * skill/domain content; `behavioral` = probes how the candidate has applied
 * it. Stored as text + CHECK from this set (ADR-0003, never a pg enum).
 */
export const INTERVIEW_QUESTION_KINDS = ['technical', 'behavioral'] as const;
export const interviewQuestionKindSchema = z.enum(INTERVIEW_QUESTION_KINDS);
export type InterviewQuestionKind = z.infer<typeof interviewQuestionKindSchema>;

/**
 * The two talking-point shapes: `evidence` = cites exactly one SENT evidence
 * link belonging to its question's requirement (ADR-0006 — the model may
 * only cite what the server sent it); `gap_disclosure` = the honest "this is
 * a gap" statement (never invented experience), resolved server-side to the
 * requirement's gap row. The two are structurally exclusive — the points
 * table CHECK admits exactly the FK matching the type.
 */
export const INTERVIEW_POINT_TYPES = ['evidence', 'gap_disclosure'] as const;
export const interviewPointTypeSchema = z.enum(INTERVIEW_POINT_TYPES);
export type InterviewPointType = z.infer<typeof interviewPointTypeSchema>;

/**
 * The gap classifications that OBLIGE a gap_disclosure point on their
 * requirement's questions (the M3-04 disclosure tripwire): everything except
 * `have`. A requirement with NO gap row carries no obligation — absence of a
 * classification is not "non-have" (M3-04 gate condition 2). Named subset of
 * GAP_CLASSIFICATIONS (the REQUIREMENT_BEARING_STATUSES idiom) so the
 * tripwire, the prompt payload, and the tests key on one definition.
 */
export const GAP_DISCLOSURE_REQUIRED_CLASSIFICATIONS = [
  'have_undemonstrated',
  'needs_refresh',
  'genuine_gap',
  'low_priority',
] as const satisfies readonly GapClassification[];
