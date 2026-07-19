import type {
  DraftingEvidenceInput,
  DraftingGapInput,
  DraftingSkillInput,
} from '../../drafting/payload.ts';
import type { AttackClass, LiveExpectation } from '../types.ts';

// The drafting adversarial corpus aggregate (M1-12 section 5). Reuses the M1-07
// attack-class union and live-expectation shape; the ingress differs --
// attacks arrive through posting-DERIVED strings inside the structured
// payload, never raw posting text (ADR-0006 layer 2).

export interface DraftingAdversarialFixture {
  /** Stable kebab id, unique across the drafting corpus. */
  id: string;
  class: AttackClass;
  description: string;
  /** Structured payload inputs with the attack embedded (fictional;
   *  non-ASCII as visible escapes per the source-byte law). */
  skills: readonly DraftingSkillInput[];
  gaps: readonly DraftingGapInput[];
  evidence: readonly DraftingEvidenceInput[];
  /** The mechanical invariant drafting.structural.test.ts pins for this
   *  fixture, independent of model behavior. */
  ciGuard: string;
  liveExpectation: LiveExpectation;
}

/** The four attack classes this corpus covers (a subset of the M1-07 six --
 *  html-script and role-play-coercion target raw-posting display/extraction
 *  surfaces that do not exist at the drafting ingress; ratified M1-12 section 5). */
export const DRAFTING_ATTACK_CLASSES = [
  'instruction-override',
  'fake-delimiter',
  'unicode-smuggling',
  'system-prompt-probe',
] as const satisfies readonly AttackClass[];

export { draftingAdversarialFixtures as DRAFTING_ADVERSARIAL_CORPUS } from './fixtures.ts';
