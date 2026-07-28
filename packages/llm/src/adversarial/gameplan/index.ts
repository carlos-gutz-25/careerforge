import type {
  GameplanEvidenceInput,
  GameplanImprovementPlanInput,
  GameplanRequirementInput,
  GameplanSkillInput,
} from '../../drafting/gameplan-payload.ts';
import type { AcceptableStatus } from '../types.ts';

// The application-gameplan live-pass corpus (M7-06, ADR-0006 layer 6 at the
// gameplan ingress, ADR-0019 layer L2 verification). This story ships the
// CLEAN-CONTROL class only: benign fictional fixtures that prove the prompt's
// contract holds on clean input (in-contract JSON, zero outreach-shaped
// structure, zero pointers, sane citations). The never-send-BAIT attack class,
// the attack-class widening of this union, the forged-marker structural leg, and
// the adversarial live legs are ALL M7-08 (BACKLOG line 624) - it plugs its
// fixtures into this same instrument (interface + evaluator + CLI).
//
// House rules: fictional everything (companies, people, products invented;
// base-public tech names like TypeScript/PostgreSQL are fine); printable-ASCII
// source (the corpus source-byte law, gameplan.corpus.test.ts); kebab ids; any
// fictional host uses the reserved .example TLD (none expected in clean
// fixtures). Attack content (injected instructions, canaries, bait) is FORBIDDEN
// in this story - that is M7-08's corpus.

/** The live-pass fixture classes. M7-06 ships only clean-control; M7-08 widens
 *  this with its own attack classes (its call which). */
export const GAMEPLAN_FIXTURE_CLASSES = ['clean-control'] as const;
export type GameplanFixtureClass = (typeof GAMEPLAN_FIXTURE_CLASSES)[number];

/** The live expectation for a gameplan fixture. `forbiddenSubstrings` MAY be
 *  empty for clean-control (nothing is injected); the corpus test asserts
 *  non-empty only for NON-clean classes (which M7-08 introduces). */
export interface GameplanLiveExpectation {
  /** Runner statuses bounded-by-design for this fixture. Clean-control uses
   *  exactly ['ok'] - a schema failure on CLEAN input means the prompt/schema
   *  pairing does not work, which this pass exists to catch (D7). */
  acceptableStatuses: readonly AcceptableStatus[];
  /** Obey-markers that appear in output ONLY if an injected instruction was
   *  followed. Vacuous (empty) for clean-control; live-bearing at M7-08. */
  forbiddenSubstrings: readonly string[];
}

export interface GameplanAdversarialFixture {
  /** Stable kebab id, unique across the corpus. */
  id: string;
  class: GameplanFixtureClass;
  description: string;
  /** buildGameplanPayload's inputs (fictional; any non-ASCII codepoint MUST be a
   *  visible \uXXXX escape per the source-byte law). */
  skills: readonly GameplanSkillInput[];
  requirements: readonly GameplanRequirementInput[];
  evidence: readonly GameplanEvidenceInput[];
  improvementPlan: GameplanImprovementPlanInput | null;
  /** The mechanical invariant gameplan.structural.test.ts pins for this fixture,
   *  independent of model behavior. */
  ciGuard: string;
  liveExpectation: GameplanLiveExpectation;
}

export { gameplanAdversarialFixtures as GAMEPLAN_ADVERSARIAL_CORPUS } from './fixtures.ts';
