import { z } from 'zod';

import {
  applicationStageSchema,
  evidenceStrengthSchema,
  gameplanDraftingRunStatusSchema,
  GAMEPLAN_PHASES,
  gameplanPhaseSchema,
  type GameplanPhase,
  planReviewStatusSchema,
  requirementCategorySchema,
  requirementKindSchema,
} from './enums.ts';

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

// ---------------------------------------------------------------------------
// API wire schemas (M7-07, ADR-0019 layer L3 read surface). The gameplan's
// response/projection contracts for POST/GET /postings/:id/gameplan,
// POST /application-gameplans/:id/review, and POST /application-gameplans/:id/checks.
// Mirrors interview.ts naming. Two values NEVER cross the wire: `rawResponse`
// (audit/replay only, UNTRUSTED + PRIVATE) and `user_id` (ADR-0007) — the run
// wire below omits both structurally. Strategy/story text and evidence quotes are
// LLM/posting-DERIVED and UNTRUSTED on display (escaped, never rendered as
// HTML/markdown — RISKS S-02). All schemas are strict: an unknown key is rejected.

/** One drafting wire call — the InterviewPrepRun twin (M1-05 law, one row per
 *  wire call). `rawResponse` and `userId` are deliberately absent from the wire. */
export const applicationGameplanRunSchema = z.strictObject({
  id: z.string(),
  promptId: z.string(),
  provider: z.string(),
  model: z.string(),
  status: gameplanDraftingRunStatusSchema,
  attempt: z.number().int().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadInputTokens: z.number().int().min(0),
  cacheCreationInputTokens: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type ApplicationGameplanRun = z.infer<typeof applicationGameplanRunSchema>;

/** One rendered checklist item in the read-time overlay: a code-owned template
 *  (key/phase/label from GAMEPLAN_CHECKLIST_TEMPLATES) merged with its toggle row
 *  (`done`). Labels come from CODE, never the DB (the lazy-checks policy, D6). */
export const gameplanChecklistItemSchema = z.strictObject({
  key: gameplanCheckKeySchema,
  phase: gameplanPhaseSchema,
  label: z.string(),
  done: z.boolean(),
});
export type GameplanChecklistItem = z.infer<typeof gameplanChecklistItemSchema>;

/** One application stage_change event attached to a phase in the timeline overlay.
 *  `fromStage`/`toStage` are raw APPLICATION_STAGES parsed from the event detail
 *  (`parseStageChangeDetail`), each validated against applicationStageSchema; an
 *  event attaches to the phase whose GAMEPLAN_PHASE_TO_APPLICATION_STAGE value
 *  equals its `toStage`. TO stages OUTSIDE the mapping (considering/rejected/
 *  withdrawn) are deliberately OUTSIDE the phase view — the application tracker
 *  owns terminal display; the gameplan overlays active pursuit only. */
export const gameplanStageEventSchema = z.strictObject({
  occurredOn: z.iso.date(),
  fromStage: applicationStageSchema,
  toStage: applicationStageSchema,
});
export type GameplanStageEvent = z.infer<typeof gameplanStageEventSchema>;

/** One pursuit phase, assembled at read time: the model's strategy for the phase
 *  plus the two deterministic overlays (checklist items in template order, and
 *  the stage_change events mapped onto this phase). Never stored, never
 *  LLM-visible (ADR-0019 deterministic-parts law). */
export const gameplanPhaseViewSchema = z.strictObject({
  phase: gameplanPhaseSchema,
  strategy: z.string(),
  checklist: z.array(gameplanChecklistItemSchema),
  stageEvents: z.array(gameplanStageEventSchema),
});
export type GameplanPhaseView = z.infer<typeof gameplanPhaseViewSchema>;

/** One cited evidence link on a story, with its display fields joined per row
 *  (one fetch renders the story). The link belongs to the story's requirement by
 *  tripwire (cross-requirement bleed flags the run) and by FK at rest. */
export const gameplanStoryCitationWireSchema = z.strictObject({
  evidenceLinkId: z.string(),
  strength: evidenceStrengthSchema,
  postingQuote: z.string(),
  profileQuote: z.string(),
});
export type GameplanStoryCitationWire = z.infer<typeof gameplanStoryCitationWireSchema>;

/** One STAR story on the wire. `requirementId`/`requirementText`/`requirementKind`/
 *  `requirementCategory` are DERIVED at read time from the story's citations'
 *  evidence links (all citations share one requirement by tripwire construction;
 *  the read asserts agreement and throws on mixed rows — structurally impossible
 *  at rest short of a manual DB edit). `requirementRef` is NOT on the wire (it was
 *  a transient validation anchor, dropped at persist). */
export const gameplanStoryWireSchema = z.strictObject({
  id: z.string(),
  position: z.number().int().min(0),
  situation: z.string(),
  task: z.string(),
  action: z.string(),
  result: z.string(),
  requirementId: z.string(),
  requirementText: z.string(),
  requirementKind: requirementKindSchema,
  requirementCategory: requirementCategorySchema,
  citations: z.array(gameplanStoryCitationWireSchema),
});
export type GameplanStoryWire = z.infer<typeof gameplanStoryWireSchema>;

/** A meta-only sibling pointer (id + review status only — never sibling content).
 *  Join-time, never stored, never LLM-visible. */
export const gameplanSiblingPointerSchema = z.strictObject({
  id: z.string(),
  reviewStatus: planReviewStatusSchema,
});
export type GameplanSiblingPointer = z.infer<typeof gameplanSiblingPointerSchema>;

/** The two sibling artifacts of the same fit report (each UNIQUE fit_report_id),
 *  meta-only. `null` when the sibling does not exist. */
export const gameplanSiblingsSchema = z.strictObject({
  improvementPlan: gameplanSiblingPointerSchema.nullable(),
  interviewPrep: gameplanSiblingPointerSchema.nullable(),
});
export type GameplanSiblings = z.infer<typeof gameplanSiblingsSchema>;

/** One gameplan on the wire: the summary, exactly four assembled phase views
 *  (GAMEPLAN_PHASES order), the STAR stories in (position, id) order, and the
 *  meta-only sibling pointers. `notes` is null until review captures them. */
export const applicationGameplanSchema = z.strictObject({
  id: z.string(),
  fitReportId: z.string(),
  reviewStatus: planReviewStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  strategySummary: z.string(),
  phases: z.array(gameplanPhaseViewSchema).length(GAMEPLAN_PHASES.length),
  stories: z.array(gameplanStoryWireSchema),
  siblings: gameplanSiblingsSchema,
});
export type ApplicationGameplan = z.infer<typeof applicationGameplanSchema>;

/**
 * GET /postings/:id/gameplan (and the POST result shape), keyed to the posting's
 * LATEST fit report. `gameplan: null` = not yet drafted (an empty collection, not
 * a 404). Run-selection contract (the interview-prep R2 precedent): when
 * `gameplan` is non-null, `run` IS the gameplan's drafting run (via
 * drafting_run_id) — never latest-by-time; latest-by-time applies ONLY when
 * `gameplan` is null (failure display). 201 = a fresh draft ran and its run row(s)
 * were appended — INCLUDING non-ok/flagged terminal outcomes, which are results,
 * not transport errors (`run.status` is the discriminant and `gameplan` is null).
 * 200 with `cached: true` = the report's existing gameplan served with no LLM call
 * (UNIQUE fit_report_id, ADR-0019 consequence B: cache-once, not supersede;
 * regeneration = re-score).
 */
export const applicationGameplanResponseSchema = z.strictObject({
  run: applicationGameplanRunSchema.nullable(),
  gameplan: applicationGameplanSchema.nullable(),
  cached: z.boolean(),
});
export type ApplicationGameplanResponse = z.infer<typeof applicationGameplanResponseSchema>;

/** Cost-free sanity bound on gameplan review notes (text column, escaped on
 *  render; the interview-prep review-notes figure). */
export const GAMEPLAN_REVIEW_NOTES_MAX_CHARS = 10_000;

// A Postgres text column rejects U+0000 outright — reject at the boundary for a
// value-free 400 instead of a 500 (the interview-prep review-notes precedent).
const notesNoNul = (value: string) => !value.includes('\u0000');

/**
 * POST /application-gameplans/:id/review — the one-shot draft->reviewed action
 * (CAS on review_status='draft'; the interview-prep review precedent). `notes` is
 * nullish (a body-less POST reaches the validator as null); values that trim to
 * empty are stored as NULL at the service boundary.
 */
export const gameplanReviewBodySchema = z.strictObject({
  notes: z
    .string()
    .max(GAMEPLAN_REVIEW_NOTES_MAX_CHARS)
    .refine(notesNoNul, 'must not contain U+0000')
    .nullish(),
});
export type GameplanReviewBody = z.infer<typeof gameplanReviewBodySchema>;

/** Review response is meta-only (no joins): the caller already renders the
 *  gameplan; this confirms the workflow-field transition. */
export const gameplanReviewResponseSchema = z.strictObject({
  id: z.string(),
  reviewStatus: planReviewStatusSchema,
  notes: z.string().nullable(),
});
export type GameplanReviewResponse = z.infer<typeof gameplanReviewResponseSchema>;

/**
 * POST /application-gameplans/:id/checks — the checklist toggle. The closed
 * `checkKey` enum + a boolean; an unknown key is a 400 at the zod boundary before
 * any SQL (the DB CHECK is the second belt). Allowed regardless of the gameplan's
 * reviewStatus (D6): the checklist is the user's own deterministic process state,
 * NOT LLM content, so draft-until-reviewed does not gate it.
 */
export const gameplanCheckToggleBodySchema = z.strictObject({
  checkKey: gameplanCheckKeySchema,
  done: z.boolean(),
});
export type GameplanCheckToggleBody = z.infer<typeof gameplanCheckToggleBodySchema>;

/** The check-toggle response: the gameplan's FULL checklist overlay (all 11
 *  template items with each `done`), so the UI never computes state client-side. */
export const gameplanChecklistResponseSchema = z.strictObject({
  checklist: z.array(gameplanChecklistItemSchema),
});
export type GameplanChecklistResponse = z.infer<typeof gameplanChecklistResponseSchema>;
