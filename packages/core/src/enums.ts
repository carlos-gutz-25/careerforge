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

// PROFILE FACTS (M12-03, ADR-0021) — durable declarations ABOUT the candidate
// (work authorization, sponsorship need, location/remote stance, clearance,
// availability). Informative evaluators, NEVER hard filters (arc D-4). The six
// D-3 kinds; EEO/demographic fields are DELIBERATELY excluded (sensitive, zero
// matching value, wrong to model). packages/db derives the kind CHECK from this
// tuple. The closed-vocabulary VALUE sets below back the decision-bearing kinds;
// the other three kinds carry free-form text (validated non-empty in profile.ts).
export const PROFILE_FACT_KINDS = [
  'work_authorization',
  'visa_sponsorship_needed',
  'relocation_stance',
  'remote_onsite_stance',
  'security_clearance',
  'availability_notice',
] as const;
export const profileFactKindSchema = z.enum(PROFILE_FACT_KINDS);
export type ProfileFactKind = z.infer<typeof profileFactKindSchema>;

// Graded stances (D-4: never a boolean — a strong opportunity is never
// auto-excluded, so "open_for_right_opportunity" is a first-class value).
export const RELOCATION_STANCES = [
  'willing',
  'open_for_right_opportunity',
  'prefer_not',
  'no',
] as const;
export const relocationStanceSchema = z.enum(RELOCATION_STANCES);
export type RelocationStance = z.infer<typeof relocationStanceSchema>;

// A graded remote/onsite preference spectrum (parallel to relocation stances).
export const REMOTE_ONSITE_STANCES = [
  'remote_only',
  'prefer_remote',
  'flexible',
  'prefer_onsite',
  'onsite_ok',
] as const;
export const remoteOnsiteStanceSchema = z.enum(REMOTE_ONSITE_STANCES);
export type RemoteOnsiteStance = z.infer<typeof remoteOnsiteStanceSchema>;

// "Do you require visa sponsorship to work?" — a closed yes/no durable fact
// (not a graded stance): the evaluator resolves a sponsorship requirement from
// this deterministically (M12-03: `no` satisfies; `yes` needs the posting to
// affirmatively offer sponsorship, else stays `unknown`).
export const VISA_SPONSORSHIP_NEEDED_VALUES = ['yes', 'no'] as const;
export const visaSponsorshipNeededSchema = z.enum(VISA_SPONSORSHIP_NEEDED_VALUES);
export type VisaSponsorshipNeeded = z.infer<typeof visaSponsorshipNeededSchema>;

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
 * Gap classifications, in ERD/AC order. The FIRST FIVE are the M1-11 skill
 * ladder (precedence, first match wins): have -> have_undemonstrated ->
 * needs_refresh -> low_priority -> genuine_gap; their exact semantics are
 * frozen (additive-only law, ADR-0016).
 *
 * M12-02 appends three EVIDENCE-STATUS classes (never re-meaning the five).
 * They are produced by category-aware routing in packages/scoring, NOT by the
 * skill ladder:
 * - `unknown` - insufficient evidence either way. The honest replacement for
 *   the old genuine_gap fall-through: "nothing links this requirement to the
 *   profile" is no longer asserted as a confirmed gap. Carries a resolution
 *   path (add a skill row, attach mastery evidence, or declare a durable fact),
 *   never an LLM drafting obligation.
 * - `satisfied_fact` - a deterministic evaluator proved the requirement met by
 *   a FACT, not a skill (seniority years threshold here; durable profile facts
 *   in M12-03). Not a gap.
 * - `not_applicable` - assessed by another dimension/criteria (compensation,
 *   location), never a skill gap.
 * `genuine_gap` now requires a POSITIVE signal (a learning-level skill match,
 * or an operator override) - absence of evidence is `unknown`, not a gap.
 */
export const GAP_CLASSIFICATIONS = [
  'have',
  'have_undemonstrated',
  'needs_refresh',
  'genuine_gap',
  'low_priority',
  'unknown',
  'satisfied_fact',
  'not_applicable',
] as const;
export const gapClassificationSchema = z.enum(GAP_CLASSIFICATIONS);
export type GapClassification = z.infer<typeof gapClassificationSchema>;

/**
 * Which deterministic evaluator produced a gap's classification (M12-02). The
 * classifier routes on requirement.category BEFORE the skill ladder, so the
 * evaluator is the audit trail for "why this class":
 * - `skill_evidence` - the M1-11 skill ladder (language/framework/domain and
 *   non-administrative `other`).
 * - `seniority_threshold` - the shared demanded-years vs professional-span
 *   comparison (packages/scoring evaluators/seniority-threshold).
 * - `dimension_delegation` - comp/location, assessed elsewhere (not_applicable).
 * - `administrative_pattern` - an `other` requirement matched the administrative
 *   phrase list (work authorization, clearance, ...); resolved by a durable fact.
 * - `durable_profile_fact` - RESERVED, wired in M12-03 (facts evaluator); ships
 *   in the CHECK now so facts need no second migration.
 * - `manual_review` - an operator override (the override records intent, not an
 *   evaluator run).
 * Nullable on the wire/DB: rows written before M12-02 have no evaluator.
 */
export const GAP_EVALUATORS = [
  'skill_evidence',
  'seniority_threshold',
  'dimension_delegation',
  'administrative_pattern',
  'durable_profile_fact',
  'manual_review',
] as const;
export const gapEvaluatorSchema = z.enum(GAP_EVALUATORS);
export type GapEvaluator = z.infer<typeof gapEvaluatorSchema>;

/** Evaluator confidence (M12-02): `high` = a deterministic proof (numeric
 *  threshold, exact fact), `medium`/`low` grade weaker signals; `low` is the
 *  insufficient-evidence `unknown` fall-through. Nullable for pre-M12-02 rows. */
export const GAP_CONFIDENCES = ['high', 'medium', 'low'] as const;
export const gapConfidenceSchema = z.enum(GAP_CONFIDENCES);
export type GapConfidence = z.infer<typeof gapConfidenceSchema>;

/**
 * The three M12-02 EVIDENCE-STATUS classes (unknown / satisfied_fact /
 * not_applicable) - NOT skill gaps. Every LLM DRAFTING payload builder
 * (improvement / learning / interview / gameplan) drops them, so the drafting
 * prompt vocabulary stays byte-stable (no prompt-version bump - arc R-2), and
 * the market-signal cohort treats them as non-actionable. Each builder keeps
 * its existing treatment of the five skill-ladder classes; only these three
 * are uniformly excluded. Named subset (the DISCLOSURE_REQUIRED idiom).
 */
export const GAP_EVIDENCE_STATUS_CLASSIFICATIONS = [
  'unknown',
  'satisfied_fact',
  'not_applicable',
] as const satisfies readonly GapClassification[];

const evidenceStatusClassificationSet: ReadonlySet<GapClassification> = new Set(
  GAP_EVIDENCE_STATUS_CLASSIFICATIONS,
);

/** True for a classification that is an evidence STATUS, not a skill gap
 *  (M12-02) - these are never fed to LLM drafting. */
export function isEvidenceStatusClassification(classification: GapClassification): boolean {
  return evidenceStatusClassificationSet.has(classification);
}

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

/**
 * Typed improvement-plan recommendations (M7-01, ADR-0017). A recommendation is
 * a model suggestion attached to a plan item - draft-until-reviewed like its
 * parent plan, and governed by the no-URL law (a recommendation carries no
 * external pointer; `containsExternalPointer` is the tripwire). A closed
 * vocabulary: `resource | certification` are learn-it suggestions,
 * `demo_project | practice` are build-it ones. Certification is recommended
 * only when posting evidence beats the alternative use of time (ADR-0017).
 */
export const PLAN_ITEM_RECOMMENDATION_KINDS = [
  'resource',
  'certification',
  'demo_project',
  'practice',
] as const;
export const planItemRecommendationKindSchema = z.enum(PLAN_ITEM_RECOMMENDATION_KINDS);
export type PlanItemRecommendationKind = z.infer<typeof planItemRecommendationKindSchema>;

/**
 * Recommendation lifecycle. Born `suggested`; `adopted` is the USER'S OWN
 * attestation ("I did this"), never the model's claim - the honesty keystone;
 * `dismissed` is the honest "not for me", never a silent deletion (the
 * PLAN_ITEM_STATUSES `dropped` precedent). A separate const from the item-status
 * family by the same rule as PLAN_REVIEW_STATUSES: the two workflows evolve
 * independently.
 */
export const PLAN_ITEM_RECOMMENDATION_STATUSES = ['suggested', 'adopted', 'dismissed'] as const;
export const planItemRecommendationStatusSchema = z.enum(PLAN_ITEM_RECOMMENDATION_STATUSES);
export type PlanItemRecommendationStatus = z.infer<typeof planItemRecommendationStatusSchema>;

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
 * M6-04 (ADR-0018) resume-compose run statuses. The five wire statuses the
 * runner sets, plus TWO post-hoc POLICY statuses applied at the single
 * persist-policy site (deriveComposeRunStatus), never by the runner (the
 * RESUME_VARIANT_RUN_STATUSES `flagged` precedent, extended): `flagged` = the
 * claim-provenance gate returned a violation (checkClaimProvenance ok:false),
 * `empty` = an ok, gate-passing draft that carried zero claims (the M6-04
 * empty-draft policy; an empty resume is not a persisted artifact). Both mean
 * NOTHING was written; run.status is the discriminant and `document` is null.
 */
export const RESUME_COMPOSE_RUN_STATUSES = [
  'ok',
  'schema_failed',
  'refusal',
  'max_tokens',
  'error',
  'flagged',
  'empty',
] as const;
export const resumeComposeRunStatusSchema = z.enum(RESUME_COMPOSE_RUN_STATUSES);
export type ResumeComposeRunStatus = z.infer<typeof resumeComposeRunStatusSchema>;

/** M6-04 composed-document review workflow (draft-until-reviewed, ADR-0005). A
 *  separate const from RESUME_VARIANT_REVIEW_STATUSES so the two artifacts'
 *  review workflows evolve independently (the RESUME_VARIANT_REVIEW_STATUSES
 *  rationale). */
export const RESUME_DOCUMENT_REVIEW_STATUSES = ['draft', 'reviewed'] as const;
export const resumeDocumentReviewStatusSchema = z.enum(RESUME_DOCUMENT_REVIEW_STATUSES);
export type ResumeDocumentReviewStatus = z.infer<typeof resumeDocumentReviewStatusSchema>;

/** M6-04 provenance-ledger source kinds: which profile table a persisted claim
 *  citation resolves to. Stored on resume_claim_citations as the DURABLE kind
 *  (the FK is navigation, SET NULL on profile re-import), so the ledger knows
 *  each citation's source class even after its FK tombstones to NULL. */
export const CITATION_SOURCE_KINDS = [
  'experience_bullet',
  'mastery_evidence',
  'project',
  'summary',
] as const;
export const citationSourceKindSchema = z.enum(CITATION_SOURCE_KINDS);
export type CitationSourceKind = z.infer<typeof citationSourceKindSchema>;

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

// ---------------------------------------------------------------------------
// Skill-upgrade vocabulary (M3-06, ARCHITECTURE §3 skill_upgrades). A skill
// upgrade is a CONFIRMED, user-authored grant that earns a profile skill a
// higher EFFECTIVE level from completed-exercise evidence — deterministic CRUD,
// NOT LLM-drafted (no run table, no citation tripwire). Grants are APPEND-ONLY:
// a grant is never deleted; `revoked` is a status flip that restores the
// declared level (ADR-0014, park-4 resolution). Net-new here (no prior enum
// reserved it), its own named const per the sibling-artifact idiom.
export const UPGRADE_STATUSES = ['active', 'revoked'] as const;
export const upgradeStatusSchema = z.enum(UPGRADE_STATUSES);
export type UpgradeStatus = z.infer<typeof upgradeStatusSchema>;

// ---------------------------------------------------------------------------
// Case-study draft vocabulary (M4-01, ARCHITECTURE §3 case_studies). A
// case-study draft is DETERMINISTICALLY generated from a completed exercise
// (M3-02) + its mastery evidence (M3-03) — pure template assembly, NOT
// LLM-drafted (no run table, no citation tripwire; the M3-06 class). The draft
// is local bookkeeping; publishing is a manual portfolio-content step outside
// this story (the module wall stands). Net-new here, its own named const per
// the sibling-artifact idiom.

/**
 * Case-study draft lifecycle. `draft` = regenerable local snapshot (repeat POST
 * re-renders while draft); `published` = one-way CAS flip meaning "taken into
 * the portfolio", which locks refresh. NOT the draft|reviewed review family:
 * `published` is a portfolio-lifecycle terminal, not a review verdict — the
 * real published artifact is portfolio content in the public tree, not this row.
 */
export const CASE_STUDY_STATUSES = ['draft', 'published'] as const;
export const caseStudyStatusSchema = z.enum(CASE_STUDY_STATUSES);
export type CaseStudyStatus = z.infer<typeof caseStudyStatusSchema>;

/**
 * The provenance tokens M4-01 admits at the wire — a named subset of
 * PROJECT_PROVENANCES (the REQUIREMENT_BEARING_STATUSES idiom). `professional`
 * is excluded: an exercise is personal learning work by construction, and
 * professional provenance would owe the validator's R3 `sensitivityReviewed`
 * human attestation a deterministic endpoint cannot honestly emit. The DB CHECK
 * keeps the full three-token vocabulary, so a future profile-project-sourced
 * story needs no migration.
 */
export const EXERCISE_CASE_STUDY_PROVENANCES = [
  'personal',
  'personal_ai_assisted',
] as const satisfies readonly ProjectProvenance[];
export const exerciseCaseStudyProvenanceSchema = z.enum(EXERCISE_CASE_STUDY_PROVENANCES);
export type ExerciseCaseStudyProvenance = z.infer<typeof exerciseCaseStudyProvenanceSchema>;

// ---------------------------------------------------------------------------
// Application-gameplan vocabularies (M7-05, ADR-0019). The gameplan is an
// LLM-DRAFTED artifact (a third drafting family alongside improvement plans and
// interview prep) that turns a scored fit report into an apply/screen/interview/
// offer strategy plus STAR stories — and NEVER a sendable message. The checklist
// templates + keys + the message-likeness util live in ./gameplan.ts and
// ./text.ts; the vocabularies below are the closed enum sets the schema pins.

/**
 * The four gameplan phases — the ACTIVE-PURSUIT subset of APPLICATION_STAGES,
 * DERIVED (a derivation test in gameplan.test.ts enforces the link, so a change
 * to the application lifecycle turns that test RED rather than letting the phase
 * set silently drift, ADR-0019). The subset drops the pre-state `considering`
 * and the terminals `rejected`/`withdrawn`, and RENAMES the tracker's `applied`
 * to the gameplan phase `apply` (the sole rename; see
 * GAMEPLAN_PHASE_TO_APPLICATION_STAGE). This is the artifact's OWN vocabulary,
 * used by the gameplan_phase_strategies.phase enumCheck — NOT APPLICATION_STAGES.
 */
export const GAMEPLAN_PHASES = ['apply', 'screen', 'interview', 'offer'] as const;
export const gameplanPhaseSchema = z.enum(GAMEPLAN_PHASES);
export type GameplanPhase = z.infer<typeof gameplanPhaseSchema>;

/**
 * The explicit 1:1 mapping from each gameplan phase to its APPLICATION_STAGES
 * member (the only rename is `apply`<->`applied`). `satisfies Record<...>` gives
 * compile-time coverage that every phase maps to a real stage; the derivation
 * test adds the runtime tripwire (every mapped value is an APPLICATION_STAGE, and
 * the mapped set equals APPLICATION_STAGES minus the non-pursuit set). This map
 * also drives M7-07's read-time timeline overlay (application_events stage_change
 * rows map onto phases through it).
 */
export const GAMEPLAN_PHASE_TO_APPLICATION_STAGE = {
  apply: 'applied',
  screen: 'screen',
  interview: 'interview',
  offer: 'offer',
} as const satisfies Record<GameplanPhase, ApplicationStage>;

/**
 * `ok | schema_failed | refusal | max_tokens | error` are set by the LLM runner
 * (one row per wire call, the M1-05 law at its fifth call site); `flagged` is
 * applied post-hoc by the two M7-07 gameplan tripwires — message-likeness
 * (looksLikeOutreach fires on a drafted field) and story-citation provenance (a
 * fabricated or cross-requirement evidence ref), plus any containsExternalPointer
 * hit — a SINGLE flagged status carrying all three, never set by the runner.
 * Values identical to PLAN_DRAFTING_RUN_STATUSES today; a separate const by the
 * same rule as PLAN_REVIEW_STATUSES (the two workflows evolve independently, and
 * the gameplan's bespoke tripwires could plausibly diverge, ADR-0019 D4).
 */
export const GAMEPLAN_DRAFTING_RUN_STATUSES = [
  'ok',
  'schema_failed',
  'refusal',
  'max_tokens',
  'error',
  'flagged',
] as const;
export const gameplanDraftingRunStatusSchema = z.enum(GAMEPLAN_DRAFTING_RUN_STATUSES);
export type GameplanDraftingRunStatus = z.infer<typeof gameplanDraftingRunStatusSchema>;
