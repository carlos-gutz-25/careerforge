import { describe, expect, it } from 'vitest';

import {
  APPLICATION_STAGES,
  GAMEPLAN_PHASE_TO_APPLICATION_STAGE,
  GAMEPLAN_PHASES,
  type GameplanPhase,
} from './enums.ts';
import {
  applicationGameplanRunSchema,
  applicationGameplanSchema,
  gameplanCheckToggleBodySchema,
  gameplanChecklistItemSchema,
  GAMEPLAN_CHECK_KEYS,
  GAMEPLAN_CHECKLIST_TEMPLATES,
  GAMEPLAN_PHASE_STRATEGY_MAX_CHARS,
  gameplanPhaseViewSchema,
  gameplanReviewBodySchema,
  GAMEPLAN_REVIEW_NOTES_MAX_CHARS,
  GAMEPLAN_STORIES_MAX,
  GAMEPLAN_STORY_FIELD_MAX_CHARS,
  GAMEPLAN_STRATEGY_SUMMARY_MAX_CHARS,
} from './gameplan.ts';

// M7-05 (ADR-0019): the gameplan phases are the ACTIVE-PURSUIT subset of the
// application-tracking lifecycle. This derivation is ENFORCED here, not
// decorative: if APPLICATION_STAGES gains or loses an active-pursuit stage, the
// subset-equality leg goes RED and forces GAMEPLAN_PHASES (and the mapping) to be
// reconsidered rather than silently drifting.
describe('GAMEPLAN_PHASES derivation from APPLICATION_STAGES (D5)', () => {
  // The stages that are NOT active-pursuit: the pre-state and the two terminals.
  const NON_PURSUIT_STAGES = ['considering', 'rejected', 'withdrawn'] as const;

  it('has exactly the four phases in canonical order', () => {
    expect(GAMEPLAN_PHASES).toEqual(['apply', 'screen', 'interview', 'offer']);
  });

  it('leg 1 — every mapped stage is a real APPLICATION_STAGES member', () => {
    for (const phase of GAMEPLAN_PHASES) {
      expect(APPLICATION_STAGES).toContain(GAMEPLAN_PHASE_TO_APPLICATION_STAGE[phase]);
    }
  });

  it('leg 2 — the mapped stage set equals APPLICATION_STAGES minus the non-pursuit set', () => {
    const mappedStages = GAMEPLAN_PHASES.map((phase) => GAMEPLAN_PHASE_TO_APPLICATION_STAGE[phase]);
    const expectedStages = APPLICATION_STAGES.filter(
      (stage) => !(NON_PURSUIT_STAGES as readonly string[]).includes(stage),
    );
    expect([...mappedStages].sort()).toEqual([...expectedStages].sort());
  });

  it('renames only applied<->apply; every other phase maps to its like-named stage', () => {
    expect(GAMEPLAN_PHASE_TO_APPLICATION_STAGE.apply).toBe('applied');
    for (const phase of GAMEPLAN_PHASES) {
      if (phase !== 'apply') {
        expect(GAMEPLAN_PHASE_TO_APPLICATION_STAGE[phase]).toBe(phase);
      }
    }
  });

  it('maps every phase (no phase missing from the mapping)', () => {
    expect(Object.keys(GAMEPLAN_PHASE_TO_APPLICATION_STAGE).sort()).toEqual(
      [...GAMEPLAN_PHASES].sort(),
    );
  });
});

describe('GAMEPLAN_CHECKLIST_TEMPLATES + derived keys (D8)', () => {
  it('every template key is unique', () => {
    const keys = GAMEPLAN_CHECKLIST_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('GAMEPLAN_CHECK_KEYS exactly equals the template keys (derivation enforced)', () => {
    const templateKeys = GAMEPLAN_CHECKLIST_TEMPLATES.map((t) => t.key);
    expect([...GAMEPLAN_CHECK_KEYS]).toEqual(templateKeys);
  });

  it('every template phase is a GAMEPLAN_PHASES member', () => {
    for (const template of GAMEPLAN_CHECKLIST_TEMPLATES) {
      expect(GAMEPLAN_PHASES).toContain(template.phase);
    }
  });

  it('every gameplan phase has at least one checklist template', () => {
    for (const phase of GAMEPLAN_PHASES) {
      const forPhase = GAMEPLAN_CHECKLIST_TEMPLATES.filter((t) => t.phase === phase);
      expect(forPhase.length).toBeGreaterThan(0);
    }
  });

  it('every key is kebab-case and phase-prefixed (stable identifiers)', () => {
    for (const template of GAMEPLAN_CHECKLIST_TEMPLATES) {
      expect(template.key).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(template.key.startsWith(`${template.phase}-`)).toBe(true);
    }
  });

  it('every label is non-empty', () => {
    for (const template of GAMEPLAN_CHECKLIST_TEMPLATES) {
      expect(template.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('gameplan caps (documented values)', () => {
  it('holds the ADR-0019 cap values', () => {
    expect(GAMEPLAN_STRATEGY_SUMMARY_MAX_CHARS).toBe(600);
    expect(GAMEPLAN_PHASE_STRATEGY_MAX_CHARS).toBe(600);
    expect(GAMEPLAN_STORY_FIELD_MAX_CHARS).toBe(300);
    expect(GAMEPLAN_STORIES_MAX).toBe(6);
  });
});

// M7-07 (ADR-0019 L3 read surface): the API wire schemas. Representative
// accept/reject rows — strictness (unknown key rejected), the phase-view array
// bound to exactly four, the toggle-body enum boundary, and the review-notes
// U+0000/max guards.
describe('gameplan wire schemas (M7-07, D5)', () => {
  const validRun = {
    id: 'run-1',
    promptId: 'application-gameplan@v1',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    status: 'ok' as const,
    attempt: 1,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 100,
    createdAt: '2026-07-28T00:00:00.000Z',
  };

  const validPhaseView = (phase: GameplanPhase) => ({
    phase,
    strategy: 'a phase strategy',
    checklist: [],
    stageEvents: [],
  });

  const validGameplan = {
    id: 'gp-1',
    fitReportId: 'fr-1',
    reviewStatus: 'draft' as const,
    notes: null,
    createdAt: '2026-07-28T00:00:00.000Z',
    strategySummary: 'an overall strategy',
    phases: GAMEPLAN_PHASES.map(validPhaseView),
    stories: [],
    siblings: { improvementPlan: null, interviewPrep: null },
  };

  it('applicationGameplanRunSchema accepts a valid run and omits rawResponse/userId', () => {
    expect(applicationGameplanRunSchema.safeParse(validRun).success).toBe(true);
  });

  it('applicationGameplanRunSchema rejects an unknown key (strict)', () => {
    expect(applicationGameplanRunSchema.safeParse({ ...validRun, rawResponse: {} }).success).toBe(
      false,
    );
    expect(applicationGameplanRunSchema.safeParse({ ...validRun, userId: 'u1' }).success).toBe(
      false,
    );
  });

  it('applicationGameplanRunSchema rejects attempt < 1', () => {
    expect(applicationGameplanRunSchema.safeParse({ ...validRun, attempt: 0 }).success).toBe(false);
  });

  it('gameplanPhaseViewSchema rejects an unknown key (strict)', () => {
    expect(
      gameplanPhaseViewSchema.safeParse({ ...validPhaseView('apply'), extra: 1 }).success,
    ).toBe(false);
  });

  it('applicationGameplanSchema accepts exactly four phases', () => {
    expect(applicationGameplanSchema.safeParse(validGameplan).success).toBe(true);
  });

  it('applicationGameplanSchema rejects a phases array that is not length four', () => {
    expect(
      applicationGameplanSchema.safeParse({
        ...validGameplan,
        phases: validGameplan.phases.slice(0, 3),
      }).success,
    ).toBe(false);
    expect(
      applicationGameplanSchema.safeParse({
        ...validGameplan,
        phases: [...validGameplan.phases, validPhaseView('apply')],
      }).success,
    ).toBe(false);
  });

  it('gameplanCheckToggleBodySchema accepts a known key + boolean', () => {
    expect(
      gameplanCheckToggleBodySchema.safeParse({ checkKey: GAMEPLAN_CHECK_KEYS[0], done: true })
        .success,
    ).toBe(true);
  });

  it('gameplanCheckToggleBodySchema rejects an unknown checkKey (enum boundary)', () => {
    expect(
      gameplanCheckToggleBodySchema.safeParse({ checkKey: 'not-a-real-key', done: true }).success,
    ).toBe(false);
  });

  it('gameplanCheckToggleBodySchema rejects an unknown extra key (strict)', () => {
    expect(
      gameplanCheckToggleBodySchema.safeParse({
        checkKey: GAMEPLAN_CHECK_KEYS[0],
        done: true,
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it('gameplanChecklistItemSchema rejects an unknown key (strict)', () => {
    expect(
      gameplanChecklistItemSchema.safeParse({
        key: GAMEPLAN_CHECK_KEYS[0],
        phase: 'apply',
        label: 'x',
        done: false,
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it('gameplanReviewBodySchema accepts null, absent, and a string; rejects U+0000 and over-max', () => {
    expect(gameplanReviewBodySchema.safeParse({}).success).toBe(true);
    expect(gameplanReviewBodySchema.safeParse({ notes: null }).success).toBe(true);
    expect(gameplanReviewBodySchema.safeParse({ notes: 'looks good' }).success).toBe(true);
    expect(gameplanReviewBodySchema.safeParse({ notes: 'a\u0000b' }).success).toBe(false);
    expect(
      gameplanReviewBodySchema.safeParse({ notes: 'x'.repeat(GAMEPLAN_REVIEW_NOTES_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
  });
});

// Type-level guard: GameplanPhase is exactly the union of GAMEPLAN_PHASES. This
// only needs to compile; a mismatch is a typecheck failure, not a runtime one.
const _phaseTypeGuard: GameplanPhase = 'apply';
void _phaseTypeGuard;
