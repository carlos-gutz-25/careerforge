import { describe, expect, it } from 'vitest';

import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_STAGES,
  applicationStageSchema,
  EXTRACTION_RUN_STATUSES,
  extractionRunStatusSchema,
  JOB_POSTING_STATUSES,
  PROJECT_PROVENANCES,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_KINDS,
  requirementKindSchema,
  SKILL_LEVELS,
  skillLevelSchema,
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
  });
});
