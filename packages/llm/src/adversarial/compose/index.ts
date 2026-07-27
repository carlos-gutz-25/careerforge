import type {
  ComposeExperienceInput,
  ComposeGuidanceInput,
  ComposeProjectInput,
  ComposeSkillInput,
  ComposeSummaryInput,
} from '../../drafting/compose-payload.ts';
import type { AttackClass, LiveExpectation } from '../types.ts';

// The resume-compose adversarial corpus (M6-03, ADR-0006 layer 6 at the compose
// ingress). Reuses the M1-07 attack-class union and live-expectation shape; the
// ingress differs - attacks arrive through profile-DERIVED strings inside the
// structured payload (a bullet, a mastery item, a summary block) and through the
// posting-DERIVED guidance block, never raw posting text (ADR-0006 layer 2).

export interface ComposeAdversarialFixture {
  /** Stable kebab id, unique across the compose corpus. */
  id: string;
  class: AttackClass;
  description: string;
  /** buildComposePayload inputs with the attack embedded (fictional; any
   *  non-ASCII codepoint MUST be a visible \uXXXX escape per the source-byte law). */
  experiences: readonly ComposeExperienceInput[];
  projects: readonly ComposeProjectInput[];
  skills: readonly ComposeSkillInput[];
  summaries: readonly ComposeSummaryInput[];
  guidance: ComposeGuidanceInput;
  /** The mechanical invariant compose.structural.test.ts pins for this fixture,
   *  independent of model behavior. */
  ciGuard: string;
  liveExpectation: LiveExpectation;
}

/** The four attack classes this corpus covers (a subset of the M1-07 six -
 *  html-script and role-play-coercion target raw-posting display/extraction
 *  surfaces that do not exist at the structured compose ingress; the drafting
 *  M1-12 precedent). */
export const COMPOSE_ATTACK_CLASSES = [
  'instruction-override',
  'fake-delimiter',
  'unicode-smuggling',
  'system-prompt-probe',
] as const satisfies readonly AttackClass[];

export { composeAdversarialFixtures as COMPOSE_ADVERSARIAL_CORPUS } from './fixtures.ts';
