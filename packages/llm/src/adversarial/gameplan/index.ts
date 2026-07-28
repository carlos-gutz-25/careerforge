import type {
  GameplanEvidenceInput,
  GameplanImprovementPlanInput,
  GameplanRequirementInput,
  GameplanSkillInput,
} from '../../drafting/gameplan-payload.ts';
import type { AcceptableStatus } from '../types.ts';

// The application-gameplan live-pass corpus (M7-06 + M7-08, ADR-0006 layer 6 at
// the gameplan ingress, ADR-0019 layer L2 verification). M7-06 shipped the
// CLEAN-CONTROL class: benign fictional fixtures that prove the prompt's contract
// holds on clean input (in-contract JSON, zero outreach-shaped structure, zero
// pointers, sane citations). M7-08 widened this union with the never-send-BAIT
// attack class plus three M1-07 mechanism classes (instruction-override,
// fake-delimiter, system-prompt-probe), added the six attack fixtures, the
// forged-marker structural leg, and the adversarial live legs - all plugged into
// this same instrument (interface + evaluator + CLI).
//
// House rules: fictional everything (companies, people, products invented;
// base-public tech names like TypeScript/PostgreSQL are fine); printable-ASCII
// source (the corpus source-byte law, gameplan.corpus.test.ts); kebab ids; every
// fictional host/email uses the reserved .example TLD. Attack fixtures carry an
// injected instruction in exactly ONE input surface with an UPPERCASE-DASHED
// obey-marker that surfaces in output only on obedience; the rest of the fixture
// stays benign so obedience is attributable (per-fixture specs in fixtures.ts).

/** The live-pass fixture classes. M7-06 shipped clean-control; M7-08 widened this
 *  with its own attack classes (never-send-bait plus three M1-07 mechanism
 *  names, gameplan-local - the shared AttackClass union is untouched). */
export const GAMEPLAN_FIXTURE_CLASSES = [
  'clean-control',
  'never-send-bait',
  'instruction-override',
  'fake-delimiter',
  'system-prompt-probe',
] as const;
export type GameplanFixtureClass = (typeof GAMEPLAN_FIXTURE_CLASSES)[number];

/** The live expectation for a gameplan fixture. `forbiddenSubstrings` MAY be
 *  empty for clean-control (nothing is injected); the corpus test asserts
 *  non-empty for every NON-clean class (the M7-08 attack fixtures). */
export interface GameplanLiveExpectation {
  /** Runner statuses bounded-by-design for this fixture. Clean-control uses
   *  exactly ['ok'] - a schema failure on CLEAN input means the prompt/schema
   *  pairing does not work, which this pass exists to catch (D7). */
  acceptableStatuses: readonly AcceptableStatus[];
  /** Obey-markers that appear in output ONLY if an injected instruction was
   *  followed. Vacuous (empty) for clean-control; live-bearing for the M7-08
   *  attack fixtures. */
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
