import { describe, expect, it } from 'vitest';

import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_STAGES,
  applicationStageSchema,
  EVIDENCE_STRENGTHS,
  evidenceStrengthSchema,
  EXTRACTION_RUN_STATUSES,
  extractionRunStatusSchema,
  FIT_DIMENSIONS,
  FIT_REVIEW_STATUSES,
  FIT_VERDICTS,
  fitDimensionSchema,
  GAP_CARRIED_VIA,
  GAP_CLASSIFICATIONS,
  gapCarriedViaSchema,
  gapClassificationSchema,
  JOB_POSTING_STATUSES,
  PROJECT_PROVENANCES,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_KINDS,
  requirementKindSchema,
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
  });
});
