import type {
  TailoringEvidenceInput,
  TailoringExperienceInput,
  TailoringGapInput,
  TailoringProjectInput,
  TailoringSkillInput,
} from '../../drafting/tailoring-payload.ts';
import type { AttackClass, LiveExpectation } from '../types.ts';

// The tailoring adversarial corpus aggregate (M2-10 section 3, ADR-0006 layer 6
// applied to the THIRD ingress). resume-tailoring@v1 never sees raw posting
// text, but its structured payload carries posting-DERIVED strings (requirement
// text, rationale, evidence quotes) -- these four fixtures embed attacks
// exactly there. The model's ONLY free-text output is the emphasis `reason`, so
// an obeyed injection can only surface AS a reason (the drafting-corpus lineage,
// action -> reason).

export interface TailoringAdversarialFixture {
  /** Stable kebab id, unique across the tailoring corpus. */
  id: string;
  class: AttackClass;
  description: string;
  /** Structured payload inputs with the attack embedded (fictional;
   *  non-ASCII as visible escapes per the source-byte law). */
  skills: readonly TailoringSkillInput[];
  experiences: readonly TailoringExperienceInput[];
  projects: readonly TailoringProjectInput[];
  gaps: readonly TailoringGapInput[];
  evidence: readonly TailoringEvidenceInput[];
  /** The mechanical invariant tailoring.structural.test.ts pins for this
   *  fixture, independent of model behavior. */
  ciGuard: string;
  liveExpectation: LiveExpectation;
}

/** The four attack classes this corpus covers (a subset of the M1-07 six --
 *  html-script and role-play-coercion target raw-posting display/extraction
 *  surfaces that do not exist at the tailoring ingress; the drafting-corpus
 *  precedent, M2-10 section 3). */
export const TAILORING_ATTACK_CLASSES = [
  'instruction-override',
  'fake-delimiter',
  'unicode-smuggling',
  'system-prompt-probe',
] as const satisfies readonly AttackClass[];

export { tailoringAdversarialFixtures as TAILORING_ADVERSARIAL_CORPUS } from './fixtures.ts';
