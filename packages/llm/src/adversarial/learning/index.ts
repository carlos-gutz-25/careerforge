import type {
  LearningEvidenceInput,
  LearningGapInput,
  LearningSkillInput,
} from '../../drafting/learning-payload.ts';
import type { AttackClass, LiveExpectation } from '../types.ts';

// The learning-plan adversarial corpus aggregate (M3-01 section 5, ADR-0013). Reuses
// the M1-07 attack-class union and live-expectation shape; the ingress is the
// same class as the improvement-plan drafting ingress -- attacks arrive through
// posting-DERIVED strings inside the structured payload (requirement text,
// rationale, evidence quotes), never raw posting text (ADR-0006 layer 2). This
// is the THIRD drafting-family adversarial ingress (after drafting/ and
// tailoring/), so learning-plan@v1 owes its own fictional corpus + a live pass
// per version (the ADR-0012 precedent).

export interface LearningAdversarialFixture {
  /** Stable kebab id, unique across the learning corpus. */
  id: string;
  class: AttackClass;
  description: string;
  /** Structured payload inputs with the attack embedded (fictional; non-ASCII
   *  as visible escapes per the source-byte law). */
  skills: readonly LearningSkillInput[];
  gaps: readonly LearningGapInput[];
  evidence: readonly LearningEvidenceInput[];
  /** The mechanical invariant learning.structural.test.ts pins for this
   *  fixture, independent of model behavior. */
  ciGuard: string;
  liveExpectation: LiveExpectation;
}

/** The four attack classes this corpus covers (a subset of the M1-07 six --
 *  html-script and role-play-coercion target raw-posting display/extraction
 *  surfaces that do not exist at the drafting ingress; the drafting/ precedent). */
export const LEARNING_ATTACK_CLASSES = [
  'instruction-override',
  'fake-delimiter',
  'unicode-smuggling',
  'system-prompt-probe',
] as const satisfies readonly AttackClass[];

export { learningAdversarialFixtures as LEARNING_ADVERSARIAL_CORPUS } from './fixtures.ts';
