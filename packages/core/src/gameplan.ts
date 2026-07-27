import { z } from 'zod';

import { type GameplanPhase } from './enums.ts';

// Application-gameplan FOUNDATION consts (M7-05, ADR-0019). This file owns the
// deterministic, code-authored parts of the gameplan that are NOT enum
// vocabularies (those live in enums.ts): the checklist templates + their derived
// closed key set, and the length/count caps. Everything here is code source of
// truth — NEVER LLM-authored. SCOPE: the drafting OUTPUT schema is M7-06 (the
// prompt's outputSchema); the API response/projection schemas are M7-07 (the
// route schemas). M7-05 provides only the foundation consts + their tests.

/**
 * The code-owned checklist templates. Deterministic, phase-grouped, and never
 * LLM-authored (V2-PLAN §3.2: "code-owned checklist templates"). Each item has a
 * stable `key` (kebab-case, phase-prefixed, so a label reword never changes the
 * key), the `phase` it belongs to, and a human `label`. The per-gameplan toggle
 * STATE lives in the gameplan_checks table (keyed by `key`); the read-time
 * overlay (templates ∪ toggle rows -> the rendered checklist with each item's
 * done-state) is M7-07. All copy is generic and fictional-safe (no real posting
 * or profile data).
 */
export const GAMEPLAN_CHECKLIST_TEMPLATES = [
  { key: 'apply-tailor-resume', phase: 'apply', label: 'Tailor your resume to this posting' },
  {
    key: 'apply-reread-posting',
    phase: 'apply',
    label: 'Re-read the posting for must-have requirements',
  },
  { key: 'apply-submit', phase: 'apply', label: 'Submit the application and record the date' },
  {
    key: 'screen-recruiter-prep',
    phase: 'screen',
    label: 'Prepare a two-minute intro for the recruiter call',
  },
  {
    key: 'screen-logistics',
    phase: 'screen',
    label: 'Confirm timing, compensation range, and next steps',
  },
  {
    key: 'interview-star-rehearse',
    phase: 'interview',
    label: 'Rehearse your STAR stories out loud',
  },
  {
    key: 'interview-company-research',
    phase: 'interview',
    label: 'Research the team, product, and recent news',
  },
  {
    key: 'interview-questions-to-ask',
    phase: 'interview',
    label: 'Prepare thoughtful questions to ask the panel',
  },
  {
    key: 'offer-compensation-research',
    phase: 'offer',
    label: 'Research the compensation band for the role',
  },
  { key: 'offer-references', phase: 'offer', label: 'Line up references and give them a heads-up' },
  {
    key: 'offer-decision-criteria',
    phase: 'offer',
    label: 'Write down your accept/decline decision criteria',
  },
] as const satisfies readonly { key: string; phase: GameplanPhase; label: string }[];

/**
 * The closed set of checklist keys, DERIVED from GAMEPLAN_CHECKLIST_TEMPLATES —
 * the single source of truth for the gameplan_checks.check_key enumCheck (an
 * unknown key cannot be inserted). A unit test pins keys ≡ template keys, so
 * adding a template without this staying in sync goes RED. NOTE (ADR-0019
 * consequence A): because this closed set is baked into the DDL CHECK, adding or
 * renaming a template later is a follow-up forward-only migration event.
 */
export const GAMEPLAN_CHECK_KEYS = [
  'apply-tailor-resume',
  'apply-reread-posting',
  'apply-submit',
  'screen-recruiter-prep',
  'screen-logistics',
  'interview-star-rehearse',
  'interview-company-research',
  'interview-questions-to-ask',
  'offer-compensation-research',
  'offer-references',
  'offer-decision-criteria',
] as const;
export const gameplanCheckKeySchema = z.enum(GAMEPLAN_CHECK_KEYS);
export type GameplanCheckKey = z.infer<typeof gameplanCheckKeySchema>;

// Length/count caps — enforced at the zod boundary (the M7-06 prompt outputSchema
// and the M7-07 validator), NOT as DB length CHECKs (the interview-prep
// precedent: the DB pins vocabularies + cardinalities, zod pins lengths/counts).
export const GAMEPLAN_STRATEGY_SUMMARY_MAX_CHARS = 600;
export const GAMEPLAN_PHASE_STRATEGY_MAX_CHARS = 600;
export const GAMEPLAN_STORY_FIELD_MAX_CHARS = 300;
export const GAMEPLAN_STORIES_MAX = 6;
