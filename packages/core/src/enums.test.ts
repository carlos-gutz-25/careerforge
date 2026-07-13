import { describe, expect, it } from 'vitest';

import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_STAGES,
  applicationStageSchema,
  JOB_POSTING_STATUSES,
  PROJECT_PROVENANCES,
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
  });

  it('zod schemas accept members and reject non-members', () => {
    expect(skillLevelSchema.parse('rusty')).toBe('rusty');
    expect(skillLevelSchema.safeParse('ninja').success).toBe(false);
    expect(applicationStageSchema.parse('screen')).toBe('screen');
    expect(applicationStageSchema.safeParse('ghosted').success).toBe(false);
  });
});
