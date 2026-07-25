import { describe, expect, it } from 'vitest';

import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_STAGES,
  applicationStageSchema,
  EVIDENCE_KINDS,
  EVIDENCE_STRENGTHS,
  evidenceKindSchema,
  evidenceStrengthSchema,
  EXERCISE_KINDS,
  EXERCISE_STATUSES,
  exerciseKindSchema,
  exerciseStatusSchema,
  EXTRACTION_RUN_STATUSES,
  extractionRunStatusSchema,
  FIT_DIMENSIONS,
  FIT_REVIEW_STATUSES,
  FIT_VERDICTS,
  fitDimensionSchema,
  GAP_CARRIED_VIA,
  GAP_CLASSIFICATIONS,
  GAP_DISCLOSURE_REQUIRED_CLASSIFICATIONS,
  gapCarriedViaSchema,
  gapClassificationSchema,
  INTERVIEW_POINT_TYPES,
  INTERVIEW_QUESTION_KINDS,
  interviewPointTypeSchema,
  interviewQuestionKindSchema,
  JOB_POSTING_STATUSES,
  PROJECT_PROVENANCES,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_KINDS,
  requirementKindSchema,
  RESUME_EMPHASIS_LEVELS,
  RESUME_ENTITY_TYPES,
  RESUME_VARIANT_REVIEW_STATUSES,
  RESUME_VARIANT_RUN_STATUSES,
  resumeEmphasisLevelSchema,
  resumeEntityTypeSchema,
  resumeVariantReviewStatusSchema,
  resumeVariantRunStatusSchema,
  SKILL_LEVELS,
  skillLevelSchema,
  UNSCORED_REQUIREMENT_REASONS,
} from './enums.ts';

// The value sets are the contract between the ERD (ARCHITECTURE.md §3), the
// DB CHECK constraints, and API validation — pin them verbatim.
describe('schema v1 enum value sets', () => {
  it('matches the ERD documented values', () => {
    expect(SKILL_LEVELS).toEqual(['expert', 'solid', 'rusty', 'learning']);
    expect(PROJECT_PROVENANCES).toEqual(['professional', 'personal', 'personal_ai_assisted']);
    expect(JOB_POSTING_STATUSES).toEqual(['new', 'extracted', 'scored', 'archived']);
    expect(APPLICATION_STAGES).toEqual([
      'considering',
      'applied',
      'screen',
      'interview',
      'offer',
      'rejected',
      'withdrawn',
    ]);
    expect(APPLICATION_EVENT_KINDS).toEqual(['stage_change', 'note', 'outcome']);
    // Runner's five states + post-hoc `flagged` (M1-06) — the full vocabulary
    // is in the CHECK from day one so M1-06 needs no migration.
    expect(EXTRACTION_RUN_STATUSES).toEqual([
      'ok',
      'schema_failed',
      'refusal',
      'max_tokens',
      'error',
      'flagged',
    ]);
    expect(REQUIREMENT_KINDS).toEqual(['must_have', 'nice_to_have']);
    expect(REQUIREMENT_CATEGORIES).toEqual([
      'language',
      'framework',
      'domain',
      'seniority',
      'comp',
      'location',
      'other',
    ]);
    // Fit engine vocabularies (M1-09) — the seven AC dimensions in ERD order,
    // and the report/evidence/review value sets the DB CHECKs derive from.
    expect(FIT_DIMENSIONS).toEqual([
      'min_quals',
      'technical',
      'domain',
      'seniority',
      'comp_location',
      'priority',
      'stretch',
    ]);
    expect(FIT_VERDICTS).toEqual(['scored', 'excluded']);
    expect(EVIDENCE_STRENGTHS).toEqual(['direct', 'partial', 'adjacent']);
    expect(FIT_REVIEW_STATUSES).toEqual(['draft', 'reviewed']);
    expect(UNSCORED_REQUIREMENT_REASONS).toEqual(['failed_verification', 'not_yet_verified']);
    // Gap vocabularies (M1-11) — the five AC buckets in ERD order, and the
    // carry-audit values the DB CHECKs derive from.
    expect(GAP_CLASSIFICATIONS).toEqual([
      'have',
      'have_undemonstrated',
      'needs_refresh',
      'genuine_gap',
      'low_priority',
    ]);
    expect(GAP_CARRIED_VIA).toEqual(['requirement_id', 'content']);
    // Resume tailoring vocabularies (M2-10) — run states mirror the drafting
    // family, the review pair matches every other artifact, and the entity /
    // emphasis sets the DB CHECKs derive from.
    expect(RESUME_VARIANT_RUN_STATUSES).toEqual([
      'ok',
      'schema_failed',
      'refusal',
      'max_tokens',
      'error',
      'flagged',
    ]);
    expect(RESUME_VARIANT_REVIEW_STATUSES).toEqual(['draft', 'reviewed']);
    expect(RESUME_ENTITY_TYPES).toEqual(['skill', 'experience', 'project']);
    expect(RESUME_EMPHASIS_LEVELS).toEqual(['lead', 'highlight']);
    // Exercise vocabularies (M3-02) — the four user-picked kinds, and the
    // three-value status family the DB CHECKs derive from.
    expect(EXERCISE_KINDS).toEqual(['kata', 'project', 'writeup', 'interview_drill']);
    expect(EXERCISE_STATUSES).toEqual(['planned', 'in_progress', 'complete']);
    // Mastery-evidence kinds (M3-03) — how an exercise was proven.
    expect(EVIDENCE_KINDS).toEqual(['implemented', 'tested', 'explained', 'revisited']);
    // Interview-prep vocabularies (M3-04) — the two question kinds (gate
    // decision (c)) and the two structurally exclusive point types.
    expect(INTERVIEW_QUESTION_KINDS).toEqual(['technical', 'behavioral']);
    expect(INTERVIEW_POINT_TYPES).toEqual(['evidence', 'gap_disclosure']);
  });

  it('disclosure obligation = every gap classification except `have` (M3-04 tripwire set)', () => {
    // Pinned as a DERIVATION so a future sixth classification cannot silently
    // skip the disclosure obligation: extending GAP_CLASSIFICATIONS breaks
    // this test until the tripwire set is deliberately revisited. A
    // requirement with NO gap row is outside this set by definition (gate
    // condition 2) — absence is not "non-have".
    expect(GAP_DISCLOSURE_REQUIRED_CLASSIFICATIONS).toEqual(
      GAP_CLASSIFICATIONS.filter((c) => c !== 'have'),
    );
  });

  it('EVIDENCE_KINDS is a distinct axis from EVIDENCE_STRENGTHS (never conflate them)', () => {
    // KINDS name WHAT was done to close a gap (M3-03); STRENGTHS grade HOW
    // strongly a profile fact backs a requirement (M1-09). Disjoint value sets.
    for (const kind of EVIDENCE_KINDS) {
      expect(EVIDENCE_STRENGTHS).not.toContain(kind);
    }
  });

  it('exercise status has no `dropped` — that is the LLM plan-item state, not a user exercise (M3-02 D2)', () => {
    // PLAN_ITEM_STATUSES carries `dropped`; an exercise a user abandons is
    // DELETEd, never `dropped`. The two share only the three-value terminal
    // vocabulary, and this pins the divergence.
    expect(EXERCISE_STATUSES).not.toContain('dropped');
    expect(exerciseStatusSchema.safeParse('dropped').success).toBe(false);
  });

  it('gap buckets are classifications, never verdicts (vocabulary law)', () => {
    // "verdict" stays reserved for scored|excluded; no gap bucket or
    // carry-audit value may borrow it.
    for (const value of [...GAP_CLASSIFICATIONS, ...GAP_CARRIED_VIA]) {
      expect(value).not.toMatch(/verdict/i);
    }
  });

  it('zod schemas accept members and reject non-members', () => {
    expect(skillLevelSchema.parse('rusty')).toBe('rusty');
    expect(skillLevelSchema.safeParse('ninja').success).toBe(false);
    expect(applicationStageSchema.parse('screen')).toBe('screen');
    expect(applicationStageSchema.safeParse('ghosted').success).toBe(false);
    expect(extractionRunStatusSchema.parse('flagged')).toBe('flagged');
    expect(extractionRunStatusSchema.safeParse('pending').success).toBe(false);
    expect(requirementKindSchema.parse('must_have')).toBe('must_have');
    expect(requirementKindSchema.safeParse('required').success).toBe(false);
    expect(fitDimensionSchema.parse('comp_location')).toBe('comp_location');
    expect(fitDimensionSchema.safeParse('overall').success).toBe(false);
    expect(evidenceStrengthSchema.parse('adjacent')).toBe('adjacent');
    expect(evidenceStrengthSchema.safeParse('weak').success).toBe(false);
    expect(gapClassificationSchema.parse('genuine_gap')).toBe('genuine_gap');
    expect(gapClassificationSchema.safeParse('wont_fix').success).toBe(false);
    expect(gapCarriedViaSchema.parse('content')).toBe('content');
    expect(gapCarriedViaSchema.safeParse('history').success).toBe(false);
    expect(resumeVariantRunStatusSchema.parse('flagged')).toBe('flagged');
    expect(resumeVariantRunStatusSchema.safeParse('pending').success).toBe(false);
    expect(resumeVariantReviewStatusSchema.parse('reviewed')).toBe('reviewed');
    expect(resumeVariantReviewStatusSchema.safeParse('approved').success).toBe(false);
    expect(resumeEntityTypeSchema.parse('experience')).toBe('experience');
    expect(resumeEntityTypeSchema.safeParse('summary').success).toBe(false);
    expect(resumeEmphasisLevelSchema.parse('lead')).toBe('lead');
    expect(resumeEmphasisLevelSchema.safeParse('bold').success).toBe(false);
    expect(exerciseKindSchema.parse('interview_drill')).toBe('interview_drill');
    expect(exerciseKindSchema.safeParse('quiz').success).toBe(false);
    expect(exerciseStatusSchema.parse('in_progress')).toBe('in_progress');
    expect(exerciseStatusSchema.safeParse('done').success).toBe(false);
    expect(evidenceKindSchema.parse('implemented')).toBe('implemented');
    expect(evidenceKindSchema.safeParse('read').success).toBe(false);
    expect(interviewQuestionKindSchema.parse('behavioral')).toBe('behavioral');
    expect(interviewQuestionKindSchema.safeParse('situational').success).toBe(false);
    expect(interviewPointTypeSchema.parse('gap_disclosure')).toBe('gap_disclosure');
    expect(interviewPointTypeSchema.safeParse('anecdote').success).toBe(false);
  });
});
