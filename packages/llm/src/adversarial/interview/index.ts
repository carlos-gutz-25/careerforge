import type {
  InterviewEvidenceInput,
  InterviewRequirementInput,
  InterviewSkillInput,
} from '../../drafting/interview-payload.ts';
import type { AttackClass, LiveExpectation } from '../types.ts';

// The interview-prep adversarial corpus aggregate (M3-04 section 8, ADR-0013).
// Reuses the M1-07 attack-class union and live-expectation shape; the ingress
// is the same class as the other drafting ingresses -- attacks arrive through
// posting-DERIVED strings inside the structured payload (requirement text,
// evidence quotes), never raw posting text (ADR-0006 layer 2). This is the
// FOURTH drafting-family adversarial ingress (after drafting/, tailoring/,
// and learning/), so interview-prep@v1 owes its own fictional corpus + a live
// pass per version (the ADR-0012 precedent).

export interface InterviewAdversarialFixture {
  /** Stable kebab id, unique across the interview corpus. */
  id: string;
  class: AttackClass;
  description: string;
  /** Structured payload inputs with the attack embedded (fictional; non-ASCII
   *  as visible escapes per the source-byte law). */
  skills: readonly InterviewSkillInput[];
  requirements: readonly InterviewRequirementInput[];
  evidence: readonly InterviewEvidenceInput[];
  /** The mechanical invariant interview.structural.test.ts pins for this
   *  fixture, independent of model behavior. */
  ciGuard: string;
  liveExpectation: LiveExpectation;
}

/** The four attack classes this corpus covers (a subset of the M1-07 six --
 *  html-script and role-play-coercion target raw-posting display/extraction
 *  surfaces that do not exist at the drafting ingress; the drafting/ precedent). */
export const INTERVIEW_ATTACK_CLASSES = [
  'instruction-override',
  'fake-delimiter',
  'unicode-smuggling',
  'system-prompt-probe',
] as const satisfies readonly AttackClass[];

export { interviewAdversarialFixtures as INTERVIEW_ADVERSARIAL_CORPUS } from './fixtures.ts';
