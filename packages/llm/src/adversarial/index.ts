import { fakeDelimiterFixtures } from './fixtures/fake-delimiter.ts';
import { htmlScriptFixtures } from './fixtures/html-script.ts';
import { instructionOverrideFixtures } from './fixtures/instruction-override.ts';
import { rolePlayCoercionFixtures } from './fixtures/role-play-coercion.ts';
import { systemPromptProbeFixtures } from './fixtures/system-prompt-probe.ts';
import { unicodeSmugglingFixtures } from './fixtures/unicode-smuggling.ts';
import type { AdversarialFixture, AttackClass } from './types.ts';

// The M1-07 adversarial corpus (ADR-0006 layer 6): every attack class the
// story enumerates, one module each, all fictional (RISKS P-01). CI structural
// guards (corpus.structural.test.ts) and the live-pass CLI both iterate this.
export const ADVERSARIAL_CORPUS: readonly AdversarialFixture[] = [
  ...instructionOverrideFixtures,
  ...rolePlayCoercionFixtures,
  ...fakeDelimiterFixtures,
  ...htmlScriptFixtures,
  ...unicodeSmugglingFixtures,
  ...systemPromptProbeFixtures,
];

// The six classes every AttackClass union member must appear in the corpus for
// (corpus.test.ts asserts coverage). Kept as a value so the test can iterate it.
export const ATTACK_CLASSES: readonly AttackClass[] = [
  'instruction-override',
  'role-play-coercion',
  'fake-delimiter',
  'html-script',
  'unicode-smuggling',
  'system-prompt-probe',
];

export type {
  AdversarialFixture,
  AttackClass,
  AcceptableStatus,
  LiveExpectation,
} from './types.ts';
