import { describe, expect, it } from 'vitest';

import {
  APPLICATION_STAGES,
  GAMEPLAN_PHASE_TO_APPLICATION_STAGE,
  GAMEPLAN_PHASES,
  type GameplanPhase,
} from './enums.ts';
import {
  GAMEPLAN_CHECK_KEYS,
  GAMEPLAN_CHECKLIST_TEMPLATES,
  GAMEPLAN_PHASE_STRATEGY_MAX_CHARS,
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

// Type-level guard: GameplanPhase is exactly the union of GAMEPLAN_PHASES. This
// only needs to compile; a mismatch is a typecheck failure, not a runtime one.
const _phaseTypeGuard: GameplanPhase = 'apply';
void _phaseTypeGuard;
