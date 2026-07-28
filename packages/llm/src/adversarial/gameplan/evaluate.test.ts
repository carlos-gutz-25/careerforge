import { describe, expect, it } from 'vitest';

import { buildGameplanPayload } from '../../drafting/gameplan-payload.ts';
import type { ApplicationGameplanOutput } from '../../registry/prompts/application-gameplan/v1.ts';
import type { LlmCallRecord, RunPromptResult } from '../../run.ts';
import { evaluateGameplanFixtureRun } from './evaluate.ts';
import { GAMEPLAN_ADVERSARIAL_CORPUS } from './index.ts';

// Pure verdict logic against mocked results (the compose evaluate.test mirror).
// These rows ARE the D9 demonstrated detection for the live-pass instrument this
// story adds: a salutation/sign-off/Subject/email/URL in any prose surface MUST
// fail; a pointer in a citationRefs element MUST fail (the REQUIRED-1 widened
// surface); a dangling or cross-requirement citation is COUNTED but does NOT fail
// (M7-07's tripwire owns those) - permanent regression rows, stronger than a
// transient red run. All data is fictional; every fictional host uses the reserved
// .example TLD.

// Any clean-control fixture supplies the class + liveExpectation shell; the mocked
// output is what each row exercises.
const FIXTURE = GAMEPLAN_ADVERSARIAL_CORPUS.find((f) => f.id === 'gameplan-clean-rich-1');
if (!FIXTURE) throw new Error('gameplan corpus is missing gameplan-clean-rich-1');

// A known sent-set built by the REAL builder so the ref maps are exact:
//   r1 = req-a (evidence e1, e2), r2 = req-b (evidence e3).
const BUILT = buildGameplanPayload(
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
    {
      requirementId: 'req-b',
      quoteVerified: true,
      text: 'req b',
      kind: 'must_have',
      category: 'domain',
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
    {
      evidenceLinkId: 'el-a2',
      requirementId: 'req-a',
      strength: 'partial',
      postingQuote: 'pa2',
      profileQuote: 'pr2',
    },
    {
      evidenceLinkId: 'el-b1',
      requirementId: 'req-b',
      strength: 'direct',
      postingQuote: 'pb1',
      profileQuote: 'pr3',
    },
  ],
  null,
);
const REFS = { requirementIdByRef: BUILT.requirementIdByRef, evidenceByRef: BUILT.evidenceByRef };

const RECORD: LlmCallRecord = {
  promptId: 'application-gameplan@v1',
  provider: 'mock',
  model: 'mock-sonnet',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  latencyMs: 1,
  rawResponse: { mock: true },
  status: 'ok',
  attempt: 1,
  timestamp: '2026-07-28T10:00:00.000Z',
};

function base(): ApplicationGameplanOutput {
  return {
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
  };
}

function okResult(output: ApplicationGameplanOutput): RunPromptResult<ApplicationGameplanOutput> {
  return { status: 'ok', output, record: RECORD };
}

const evaluate = (output: ApplicationGameplanOutput) =>
  evaluateGameplanFixtureRun(FIXTURE, okResult(output), REFS);

describe('evaluateGameplanFixtureRun', () => {
  it('1. passes a clean in-contract output with every count zero', () => {
    const verdict = evaluate(base());
    expect(verdict.pass).toBe(true);
    expect(verdict.withinPreRegistration).toBe(true);
    expect(verdict.outreachHitCount).toBe(0);
    expect(verdict.pointerHitCount).toBe(0);
    expect(verdict.danglingRefCount).toBe(0);
    expect(verdict.crossRequirementCiteCount).toBe(0);
    expect(verdict.storyCount).toBe(1);
  });

  it('2. a salutation line opening a phase strategy fails with an outreach hit', () => {
    const output = base();
    output.phaseStrategies.screen = 'Dear Ms. Vantrell,\nHere is the recruiter-call plan.';
    const verdict = evaluate(output);
    expect(verdict.outreachHitCount).toBeGreaterThanOrEqual(1);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).not.toContain('Vantrell');
  });

  it('3. a standalone sign-off line in the strategy summary fails with an outreach hit', () => {
    const output = base();
    output.strategySummary =
      'Here is the recap of your pursuit strategy.\nSincerely,\nA. Candidate';
    const verdict = evaluate(output);
    expect(verdict.outreachHitCount).toBeGreaterThanOrEqual(1);
    expect(verdict.pass).toBe(false);
  });

  it('4. a "Subject:" line inside a story action fails with an outreach hit (story-field surface)', () => {
    const output = base();
    const story = output.stories[0];
    if (story) story.action = 'Subject: Application follow-up\nOpen with the migration win.';
    const verdict = evaluate(output);
    expect(verdict.outreachHitCount).toBeGreaterThanOrEqual(1);
    expect(verdict.pass).toBe(false);
  });

  it('5. an embedded email in a story result fires BOTH outreach and pointer', () => {
    const output = base();
    const story = output.stories[0];
    if (story)
      story.result = 'Follow up with the recruiter at jane@velkron.example after the loop.';
    const verdict = evaluate(output);
    expect(verdict.outreachHitCount).toBeGreaterThanOrEqual(1);
    expect(verdict.pointerHitCount).toBeGreaterThanOrEqual(1);
    expect(verdict.pass).toBe(false);
  });

  it('6. an https URL in the strategy summary fails with pointerHitCount', () => {
    const output = base();
    output.strategySummary = 'Review the role details at https://velkron.example before applying.';
    const verdict = evaluate(output);
    expect(verdict.pointerHitCount).toBe(1);
    expect(verdict.outreachHitCount).toBe(0);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).not.toContain('velkron.example');
  });

  it('7. a pointer inside a citationRefs element fails with pointerHitCount (widened surface)', () => {
    const output = base();
    const story = output.stories[0];
    if (story) story.citationRefs = ['https://velkron.example'];
    const verdict = evaluate(output);
    expect(verdict.pointerHitCount).toBeGreaterThanOrEqual(1);
    expect(verdict.pass).toBe(false);
  });

  it('8. mid-sentence greeting/closing words do NOT flag (the line-anchored boundary carries through)', () => {
    const output = base();
    output.strategySummary =
      'In the screen, say hi to the recruiter warmly and thank the interviewer for their time afterward.';
    output.phaseStrategies.interview = 'The best approach is to lead with the migration story.';
    const verdict = evaluate(output);
    expect(verdict.outreachHitCount).toBe(0);
    expect(verdict.pass).toBe(true);
  });

  it('9. a pinned tech name (socket.io) in a phase strategy is NOT a pointer', () => {
    const output = base();
    output.phaseStrategies.apply = 'Mention your fictional socket.io realtime demo.';
    const verdict = evaluate(output);
    expect(verdict.pointerHitCount).toBe(0);
    expect(verdict.pass).toBe(true);
  });

  it('10. a dangling e-ref is counted but does NOT fail (informational)', () => {
    const output = base();
    const story = output.stories[0];
    if (story) story.citationRefs = ['e9'];
    const verdict = evaluate(output);
    expect(verdict.danglingRefCount).toBeGreaterThanOrEqual(1);
    expect(verdict.pass).toBe(true);
  });

  it('11. a citation owned by a different requirement is counted but does NOT fail (informational)', () => {
    const output = base();
    const story = output.stories[0];
    // Story targets r1 but cites e3, which belongs to r2.
    if (story) story.citationRefs = ['e3'];
    const verdict = evaluate(output);
    expect(verdict.crossRequirementCiteCount).toBeGreaterThanOrEqual(1);
    expect(verdict.danglingRefCount).toBe(0);
    expect(verdict.pass).toBe(true);
  });

  it('12. schema_failed on a clean-control fixture is outside pre-registration and fails (the D7 status pin)', () => {
    const verdict = evaluateGameplanFixtureRun(
      FIXTURE,
      { status: 'schema_failed', record: RECORD },
      REFS,
    );
    expect(verdict.withinPreRegistration).toBe(false);
    expect(verdict.pass).toBe(false);
    expect(verdict.storyCount).toBe(0);
    expect(verdict.outreachHitCount).toBe(0);
    expect(verdict.pointerHitCount).toBe(0);
  });

  it('13. refusal fails with a value-free reason', () => {
    const verdict = evaluateGameplanFixtureRun(
      FIXTURE,
      { status: 'refusal', record: RECORD },
      REFS,
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.withinPreRegistration).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });
});
