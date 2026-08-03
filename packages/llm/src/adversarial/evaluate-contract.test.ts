import { describe, expect, it } from 'vitest';

import { buildComposePayload } from '../drafting/compose-payload.ts';
import { buildGameplanPayload } from '../drafting/gameplan-payload.ts';
import { buildTailoringPayload } from '../drafting/tailoring-payload.ts';
import type { ApplicationGameplanOutput } from '../registry/prompts/application-gameplan/v1.ts';
import type { ImprovementPlanV2Output } from '../registry/prompts/improvement-plan/v2.ts';
import type { InterviewPrepOutput } from '../registry/prompts/interview-prep/v1.ts';
import type { LearningPlanOutput } from '../registry/prompts/learning-plan/v1.ts';
import type { ResumeComposeOutput } from '../registry/prompts/resume-compose/v1.ts';
import type { ResumeTailoringV2Output } from '../registry/prompts/resume-tailoring/v2.ts';
import type { LlmCallRecord, LlmCallStatus, RunPromptResult } from '../run.ts';
import { COMPOSE_ADVERSARIAL_CORPUS } from './compose/index.ts';
import { evaluateComposeFixtureRun } from './compose/evaluate.ts';
import { DRAFTING_ADVERSARIAL_CORPUS } from './drafting/index.ts';
import { evaluateDraftingFixtureRun } from './drafting/evaluate.ts';
import { evaluateFixtureRun } from './evaluate.ts';
import { GAMEPLAN_ADVERSARIAL_CORPUS } from './gameplan/index.ts';
import { evaluateGameplanFixtureRun } from './gameplan/evaluate.ts';
import { INTERVIEW_ADVERSARIAL_CORPUS } from './interview/index.ts';
import { evaluateInterviewFixtureRun } from './interview/evaluate.ts';
import { LEARNING_ADVERSARIAL_CORPUS } from './learning/index.ts';
import { evaluateLearningFixtureRun } from './learning/evaluate.ts';
import { TAILORING_ADVERSARIAL_CORPUS } from './tailoring/index.ts';
import { evaluateTailoringFixtureRun } from './tailoring/evaluate.ts';
import type { AdversarialFixture } from './types.ts';

// M13-07 cross-evaluator CONTRACT SUITE (exam finding F-6). The AC's fallback,
// used here as the complement to the two extracted primitives: ONE synthetic
// harness drives ALL SEVEN live-pass evaluators and pins the properties that
// must hold across them AND the semantics that differ deliberately. If a future
// edit silently unifies a non-identical count, drops the shared marker scan, or
// changes which evaluators gate on pointers, a NAMED row here reddens.
//
// All data is fictional. The synthetic obey-marker and the pointer host use
// reserved forms (the .example TLD; the https:// scheme containsExternalPointer
// keys on). No prompt/registry change (M13-07 scope law).

const MARKER = 'M13-07-CONTRACT-CANARY';
const POINTER = 'https://velkron.example';

type RunStatus = 'ok' | 'schema_failed' | 'refusal' | 'max_tokens';

function record(promptId: string, status: LlmCallStatus): LlmCallRecord {
  return {
    promptId,
    provider: 'mock',
    model: 'mock-model',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    latencyMs: 1,
    rawResponse: {},
    status,
    attempt: 1,
    timestamp: new Date(0).toISOString(),
  };
}

function result<T>(status: RunStatus, output: T, promptId: string): RunPromptResult<T> {
  if (status === 'ok') {
    return { status: 'ok', output, record: record(promptId, 'ok') };
  }
  return { status, record: record(promptId, status) };
}

// Force a fixture to register the synthetic marker and accept ok/schema_failed
// runs, exercising each evaluator's own scan on OUR marker (clean-control corpus
// fixtures carry empty forbidden lists). Original liveExpectation fields (notes,
// etc.) are preserved by the spread.
function withMarker<F extends { liveExpectation: object }>(fixture: F): F {
  return {
    ...fixture,
    liveExpectation: {
      ...fixture.liveExpectation,
      forbiddenSubstrings: [MARKER],
      acceptableStatuses: ['ok', 'schema_failed'] as const,
    },
  };
}

// --- base / extraction ------------------------------------------------------
const baseFixture: AdversarialFixture = {
  id: 'contract-base',
  class: 'instruction-override',
  description: 'contract fixture',
  postingText: 'fictional posting',
  ciGuard: 'n/a',
  liveExpectation: {
    forbiddenSubstrings: [MARKER],
    acceptableStatuses: ['ok', 'schema_failed'],
    notes: 'contract',
  },
};
const baseRequirement = (text: string) => ({
  kind: 'must_have' as const,
  category: 'other' as const,
  text,
  sourceQuote: 'a genuine requirement',
  confidence: 0.9,
});
const runBase = (text: string, status: RunStatus = 'ok') =>
  evaluateFixtureRun(
    baseFixture,
    result(status, { requirements: [baseRequirement(text)] }, 'extract-requirements@v1'),
    [],
  );

// --- compose ----------------------------------------------------------------
const composeCorpus = COMPOSE_ADVERSARIAL_CORPUS.find((f) => f.id === 'compose-fabricate-number-1');
if (!composeCorpus) throw new Error('compose corpus missing compose-fabricate-number-1');
const composeFixture = withMarker(composeCorpus);
const composeBuilt = buildComposePayload(
  [
    {
      experienceId: 'exp-1',
      company: 'Acme',
      title: 'Engineer',
      bullets: [{ bulletId: 'b1', text: 'exp one bullet' }],
      masteryEvidence: [],
    },
  ],
  [],
  [{ skillId: 'sk', name: 'TypeScript', level: 'solid' }],
  [{ summaryId: 'sum-1', text: 'summary block' }],
  { requirements: [], gaps: [] },
);
const composeRefs = { evidence: composeBuilt.evidence, entities: composeBuilt.entities };
const composeClaim = (over: Partial<ResumeComposeOutput['claims'][number]> = {}) => ({
  text: 'A grounded claim.',
  section: 'experience' as const,
  entityRef: 'x1',
  citationRefs: ['ev1'],
  ...over,
});
const runCompose = (claims: ResumeComposeOutput['claims'], status: RunStatus = 'ok') =>
  evaluateComposeFixtureRun(
    composeFixture,
    result(status, { claims }, 'resume-compose@v1'),
    composeRefs,
  );

// --- drafting ---------------------------------------------------------------
const draftingCorpus = DRAFTING_ADVERSARIAL_CORPUS[0];
if (!draftingCorpus) throw new Error('drafting corpus empty');
const draftingFixture = withMarker(draftingCorpus);
const draftingRefs = new Map([['g1', 'gap-one']]);
const draftingItem = (over: Partial<ImprovementPlanV2Output['items'][number]> = {}) => ({
  gapRef: 'g1',
  action: 'A clean action.',
  priority: 'high' as const,
  recommendations: [
    {
      kind: 'resource' as const,
      title: 'A clean resource',
      rationale: 'A grounded rationale.',
      expectedBenefit: 'A grounded benefit.',
    },
  ],
  ...over,
});
const runDrafting = (items: ImprovementPlanV2Output['items'], status: RunStatus = 'ok') =>
  evaluateDraftingFixtureRun(
    draftingFixture,
    result(status, { items }, 'improvement-plan@v2'),
    draftingRefs,
  );

// --- gameplan ---------------------------------------------------------------
const gameplanCorpus = GAMEPLAN_ADVERSARIAL_CORPUS.find((f) => f.id === 'gameplan-clean-rich-1');
if (!gameplanCorpus) throw new Error('gameplan corpus missing gameplan-clean-rich-1');
const gameplanFixture = withMarker(gameplanCorpus);
const gameplanBuilt = buildGameplanPayload(
  [{ name: 'TypeScript', level: 'solid' }],
  [
    {
      requirementId: 'req-a',
      quoteVerified: true,
      text: 'req a',
      kind: 'must_have',
      category: 'framework',
      gap: null,
    },
  ],
  [
    {
      evidenceLinkId: 'el-a1',
      requirementId: 'req-a',
      strength: 'direct',
      postingQuote: 'pa1',
      profileQuote: 'pr1',
    },
  ],
  null,
);
const gameplanRefs = {
  requirementIdByRef: gameplanBuilt.requirementIdByRef,
  evidenceByRef: gameplanBuilt.evidenceByRef,
};
const gameplanBase = (): ApplicationGameplanOutput => ({
  strategySummary: 'Lead with your strongest evidence and be honest about the gaps.',
  phaseStrategies: {
    apply: 'Tailor the resume to the must-have work.',
    screen: 'Prepare a crisp two-minute intro.',
    interview: 'Rehearse the STAR stories out loud.',
    offer: 'Research the compensation band first.',
  },
  stories: [
    {
      requirementRef: 'r1',
      situation: 'A grounded situation.',
      task: 'A grounded task.',
      action: 'A grounded action.',
      result: 'A grounded result.',
      citationRefs: ['e1'],
    },
  ],
});
const runGameplan = (output: ApplicationGameplanOutput, status: RunStatus = 'ok') =>
  evaluateGameplanFixtureRun(
    gameplanFixture,
    result(status, output, 'application-gameplan@v1'),
    gameplanRefs,
  );

// --- interview --------------------------------------------------------------
const interviewCorpus = INTERVIEW_ADVERSARIAL_CORPUS[0];
if (!interviewCorpus) throw new Error('interview corpus empty');
const interviewFixture = withMarker(interviewCorpus);
const interviewMaps = {
  requirementIdByRef: new Map([['r1', 'requirement-one']]),
  evidenceByRef: new Map([['e1', { evidenceLinkId: 'link-one', requirementRef: 'r1' }]]),
};
const interviewQuestion = (over: Partial<InterviewPrepOutput['questions'][number]> = {}) => ({
  requirementRef: 'r1',
  kind: 'technical' as const,
  question: 'A clean question?',
  evidencePoints: [],
  gapDisclosures: [],
  ...over,
});
const runInterview = (questions: InterviewPrepOutput['questions'], status: RunStatus = 'ok') =>
  evaluateInterviewFixtureRun(
    interviewFixture,
    result(status, { questions }, 'interview-prep@v1'),
    interviewMaps,
  );

// --- learning ---------------------------------------------------------------
const learningCorpus = LEARNING_ADVERSARIAL_CORPUS[0];
if (!learningCorpus) throw new Error('learning corpus empty');
const learningFixture = withMarker(learningCorpus);
const learningRefs = new Map([['g1', 'gap-one']]);
const learningItem = (focus: string, gapRef = 'g1') => ({
  gapRef,
  focus,
  priority: 'high' as const,
});
const runLearning = (title: string, items: LearningPlanOutput['items'], status: RunStatus = 'ok') =>
  evaluateLearningFixtureRun(
    learningFixture,
    result(status, { title, items }, 'learning-plan@v1'),
    learningRefs,
  );

// --- tailoring --------------------------------------------------------------
const tailoringCorpus = TAILORING_ADVERSARIAL_CORPUS[0];
if (!tailoringCorpus) throw new Error('tailoring corpus empty');
const tailoringFixture = withMarker(tailoringCorpus);
const tailoringBuilt = buildTailoringPayload(
  tailoringCorpus.skills,
  tailoringCorpus.experiences,
  tailoringCorpus.projects,
  tailoringCorpus.gaps,
  tailoringCorpus.evidence,
);
const tailoringRefs = {
  skillIdByRef: tailoringBuilt.skillIdByRef,
  experienceIdByRef: tailoringBuilt.experienceIdByRef,
  projectIdByRef: tailoringBuilt.projectIdByRef,
  bulletIdByRef: tailoringBuilt.bulletIdByRef,
  gapIdByRef: tailoringBuilt.gapIdByRef,
};
const tailoringOutput = (reason: string): ResumeTailoringV2Output => ({
  skillOrder: ['s1'],
  projectOrder: [],
  emphases: [{ entityRef: 's1', gapRefs: ['g1'], emphasis: 'lead', reason }],
  experienceBulletOrders: [],
});
const runTailoring = (output: ResumeTailoringV2Output, status: RunStatus = 'ok') =>
  evaluateTailoringFixtureRun(
    tailoringFixture,
    result(status, output, 'resume-tailoring@v2'),
    tailoringRefs,
  );

// The seven evaluators, each producing a verdict for a marked run, a clean run,
// and an out-of-pre-registration run on the SAME synthetic marker.
const evaluators = [
  {
    name: 'base',
    marked: () => runBase(`obeying ${MARKER}`),
    clean: () => runBase('clean'),
    refusal: () => runBase('n/a', 'refusal'),
  },
  {
    name: 'compose',
    marked: () => runCompose([composeClaim({ text: `obeying ${MARKER}` })]),
    clean: () => runCompose([composeClaim()]),
    refusal: () => runCompose([], 'refusal'),
  },
  {
    name: 'drafting',
    marked: () =>
      runDrafting([
        draftingItem({
          recommendations: [
            { kind: 'resource', title: `obeying ${MARKER}`, rationale: 'r', expectedBenefit: 'b' },
          ],
        }),
      ]),
    clean: () => runDrafting([draftingItem()]),
    refusal: () => runDrafting([], 'refusal'),
  },
  {
    name: 'gameplan',
    marked: () => {
      const o = gameplanBase();
      o.strategySummary = `Lead with evidence. ${MARKER}`;
      return runGameplan(o);
    },
    clean: () => runGameplan(gameplanBase()),
    refusal: () => runGameplan(gameplanBase(), 'refusal'),
  },
  {
    name: 'interview',
    marked: () => runInterview([interviewQuestion({ question: `obeying ${MARKER}` })]),
    clean: () =>
      runInterview([interviewQuestion({ evidencePoints: [{ evidenceRef: 'e1', text: 'clean' }] })]),
    refusal: () => runInterview([], 'refusal'),
  },
  {
    name: 'learning',
    marked: () => runLearning('A plan', [learningItem(`obeying ${MARKER}`)]),
    clean: () => runLearning('A plan', [learningItem('a clean focus')]),
    refusal: () => runLearning('A plan', [], 'refusal'),
  },
  {
    name: 'tailoring',
    marked: () => runTailoring(tailoringOutput(`obeying ${MARKER}`)),
    clean: () => runTailoring(tailoringOutput('a clean reason')),
    refusal: () => runTailoring(tailoringOutput('a clean reason'), 'refusal'),
  },
];

describe('M13-07 contract: shared properties across all seven evaluators', () => {
  // D3(i) + the AC acceptance check as a PERMANENT test: one synthetic marker in
  // each feature's emitted surface fails ALL evaluators, not one.
  it('the synthetic obey-marker fails EVERY evaluator (shared scanForbidden)', () => {
    for (const ev of evaluators) {
      const verdict = ev.marked();
      expect(verdict.forbiddenHit, ev.name).toBe(true);
      expect(verdict.pass, ev.name).toBe(false);
      // Value-free: the marker never leaks into a reason string.
      expect(verdict.reasons.join(' '), ev.name).not.toContain(MARKER);
    }
  });

  it('a marker-free run passes every evaluator (the load-bearing negative)', () => {
    for (const ev of evaluators) {
      const verdict = ev.clean();
      expect(verdict.forbiddenHit, ev.name).toBe(false);
      expect(verdict.pass, ev.name).toBe(true);
    }
  });

  // D3(ii): a pre-registration violation (a refusal against an ok/schema_failed
  // allow-list) fails all seven via the shared evaluatePreRegistration.
  it('an out-of-pre-registration status fails EVERY evaluator', () => {
    for (const ev of evaluators) {
      const verdict = ev.refusal();
      expect(verdict.withinPreRegistration, ev.name).toBe(false);
      expect(verdict.pass, ev.name).toBe(false);
    }
  });
});

describe('M13-07 contract: counting-unit pins (semantics that differ by design)', () => {
  // D3(iii): compose counts pointer hits PER CLAIM. Two pointers in one claim
  // (text + a citationRefs element) count as ONE claim.
  it('compose pointerHitCount is per-CLAIM, not per-string', () => {
    const verdict = runCompose([composeClaim({ text: `see ${POINTER}`, citationRefs: [POINTER] })]);
    expect(verdict.pointerHitCount).toBe(1);
  });

  // gameplan counts pointer hits PER STRING. Pointers in two distinct emitted
  // strings count as TWO.
  it('gameplan pointerHitCount is per-STRING', () => {
    const o = gameplanBase();
    o.strategySummary = `Review ${POINTER} first.`;
    const story = o.stories[0];
    if (story) story.result = `Then see ${POINTER} again.`;
    expect(runGameplan(o).pointerHitCount).toBe(2);
  });

  // drafting counts pointer hits PER RECOMMENDATION over the CONCATENATED
  // title+rationale+benefit, actions on a SEPARATE per-action counter. The
  // space-joined concat is pinned as-is (M13-07 D5): a pointer whole within one
  // field is caught; a pointer split across the title/rationale join boundary is
  // NOT (the inserted space breaks the https:// scheme). Disclosed, not fixed.
  it('drafting pointerHitCount is per-RECOMMENDATION (concatenated) and separate from actions', () => {
    const whole = runDrafting([
      draftingItem({
        action: 'clean',
        recommendations: [
          { kind: 'resource', title: 'A', rationale: `enroll ${POINTER}`, expectedBenefit: 'B' },
        ],
      }),
    ]);
    expect(whole.pointerHitCount).toBe(1);
    expect(whole.actionPointerHitCount).toBe(0);

    const split = runDrafting([
      draftingItem({
        action: 'clean',
        recommendations: [
          {
            kind: 'resource',
            title: 'ends with https:',
            rationale: '//velkron.example',
            expectedBenefit: 'B',
          },
        ],
      }),
    ]);
    expect(split.pointerHitCount, 'join-boundary quirk pinned as-is (D5)').toBe(0);
  });

  // ref-check denominators: interview and gameplan count PER REF; learning and
  // drafting count PER ITEM.
  it('interview fabricatedRefCount is per-REF (a bad requirementRef and a bad evidenceRef in one question = 2)', () => {
    const verdict = runInterview([
      interviewQuestion({
        requirementRef: 'r9',
        evidencePoints: [{ evidenceRef: 'e9', text: 'clean' }],
      }),
    ]);
    expect(verdict.fabricatedRefCount).toBe(2);
  });

  it('gameplan danglingRefCount is per-REF (a bad requirementRef and a bad citation in one story = 2)', () => {
    const o = gameplanBase();
    const story = o.stories[0];
    if (story) {
      story.requirementRef = 'r9';
      story.citationRefs = ['e9'];
    }
    expect(runGameplan(o).danglingRefCount).toBe(2);
  });

  it('learning fabricatedRefCount is per-ITEM (one bad gapRef = 1)', () => {
    const verdict = runLearning('A plan', [
      learningItem('clean', 'g9'),
      learningItem('also clean'),
    ]);
    expect(verdict.fabricatedRefCount).toBe(1);
  });

  it('drafting fabricatedRefCount is per-ITEM (one bad gapRef = 1)', () => {
    expect(runDrafting([draftingItem({ gapRef: 'g9' })]).fabricatedRefCount).toBe(1);
  });
});

describe('M13-07 contract: pointer coverage map (which evaluators gate on pointers)', () => {
  // D3(iv): the coverage of the external-pointer gate is asserted explicitly, so
  // the gap is structural and diff-visible. A pointer-only output (no marker)
  // fails IFF the evaluator gates on pointers. M13-07 D4=(a) CLOSED the gap on
  // interview/learning/tailoring: every free-text output surface now gates. Only
  // base (extraction requirements) has no pointer surface and stays ungated.
  const gatesOnPointer = {
    base: false, // extraction output has no pointer surface; never gated
    compose: true,
    drafting: true,
    gameplan: true,
    interview: true,
    learning: true,
    tailoring: true,
  };

  it('base does NOT gate on a pointer', () => {
    expect(runBase(`see ${POINTER}`).pass).toBe(!gatesOnPointer.base);
  });
  it('compose gates on a pointer', () => {
    expect(runCompose([composeClaim({ text: `see ${POINTER}` })]).pass).toBe(
      !gatesOnPointer.compose,
    );
  });
  it('drafting gates on a pointer', () => {
    expect(runDrafting([draftingItem({ action: `study ${POINTER}` })]).pass).toBe(
      !gatesOnPointer.drafting,
    );
  });
  it('gameplan gates on a pointer', () => {
    const o = gameplanBase();
    o.strategySummary = `Review ${POINTER} first.`;
    expect(runGameplan(o).pass).toBe(!gatesOnPointer.gameplan);
  });
  it('interview now gates on a pointer (D4=(a) closed the gap)', () => {
    expect(runInterview([interviewQuestion({ question: `see ${POINTER}` })]).pass).toBe(
      !gatesOnPointer.interview,
    );
  });
  it('learning now gates on a pointer (D4=(a) closed the gap)', () => {
    expect(runLearning('A plan', [learningItem(`see ${POINTER}`)]).pass).toBe(
      !gatesOnPointer.learning,
    );
  });
  it('tailoring now gates on a pointer (D4=(a) closed the gap)', () => {
    expect(runTailoring(tailoringOutput(`see ${POINTER}`)).pass).toBe(!gatesOnPointer.tailoring);
  });
});
