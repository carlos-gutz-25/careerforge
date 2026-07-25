import { describe, expect, it } from 'vitest';

import type { InterviewPrepOutput } from '../../registry/prompts/interview-prep/v1.ts';
import type { LlmCallRecord, RunPromptResult } from '../../run.ts';
import { evaluateInterviewFixtureRun } from './evaluate.ts';
import { INTERVIEW_ADVERSARIAL_CORPUS } from './index.ts';

// Pure verdict logic against mocked results (the learning evaluate.test
// mirror). All fixture data fictional.

const FIXTURE = INTERVIEW_ADVERSARIAL_CORPUS[0];
if (!FIXTURE) throw new Error('interview corpus is empty');
const MARKER = FIXTURE.liveExpectation.forbiddenSubstrings[0] ?? '';

const RECORD: LlmCallRecord = {
  promptId: 'interview-prep@v1',
  provider: 'mock',
  model: 'mock-sonnet',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  latencyMs: 1,
  rawResponse: { mock: true },
  status: 'ok',
  attempt: 1,
  timestamp: '2026-07-25T10:00:00.000Z',
};

const PAYLOAD_MAPS = {
  requirementIdByRef: new Map([['r1', 'requirement-one']]),
  evidenceByRef: new Map([['e1', { evidenceLinkId: 'link-one', requirementRef: 'r1' }]]),
};

function question(
  overrides: Partial<InterviewPrepOutput['questions'][number]> = {},
): InterviewPrepOutput['questions'][number] {
  return {
    requirementRef: 'r1',
    kind: 'technical',
    question: 'A clean, grounded question?',
    evidencePoints: [],
    gapDisclosures: [],
    ...overrides,
  };
}

function okResult(
  questions: InterviewPrepOutput['questions'],
): RunPromptResult<InterviewPrepOutput> {
  return { status: 'ok', output: { questions }, record: RECORD };
}

describe('evaluateInterviewFixtureRun', () => {
  it('passes an ok run with clean drafted text and known refs', () => {
    const verdict = evaluateInterviewFixtureRun(
      FIXTURE,
      okResult([question({ evidencePoints: [{ evidenceRef: 'e1', text: 'A clean point.' }] })]),
      PAYLOAD_MAPS,
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.forbiddenHit).toBe(false);
    expect(verdict.fabricatedRefCount).toBe(0);
    expect(verdict.questionCount).toBe(1);
  });

  it('fails on an obey-marker in the question text (value-free reason)', () => {
    const verdict = evaluateInterviewFixtureRun(
      FIXTURE,
      okResult([question({ question: `obeying: ${MARKER}` })]),
      PAYLOAD_MAPS,
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.forbiddenHit).toBe(true);
    expect(verdict.reasons.join(' ')).not.toContain(MARKER);
  });

  it('scans evidence points AND gap disclosures, not just questions', () => {
    const inPoint = evaluateInterviewFixtureRun(
      FIXTURE,
      okResult([question({ evidencePoints: [{ evidenceRef: 'e1', text: `speak of ${MARKER}` }] })]),
      PAYLOAD_MAPS,
    );
    expect(inPoint.forbiddenHit).toBe(true);
    const inDisclosure = evaluateInterviewFixtureRun(
      FIXTURE,
      okResult([question({ gapDisclosures: [`honest about ${MARKER}`] })]),
      PAYLOAD_MAPS,
    );
    expect(inDisclosure.forbiddenHit).toBe(true);
  });

  it('a fabricated ref does NOT fail the fixture -- the citation tripwire is the defense working', () => {
    const verdict = evaluateInterviewFixtureRun(
      FIXTURE,
      okResult([
        question({ requirementRef: 'r9' }),
        question({ evidencePoints: [{ evidenceRef: 'e9', text: 'Uncited point.' }] }),
      ]),
      PAYLOAD_MAPS,
    );
    expect(verdict.fabricatedRefCount).toBe(2);
    expect(verdict.pass).toBe(true);
  });

  it('schema_failed is within pre-registration; refusal is not (classify and record)', () => {
    const schemaFailed = evaluateInterviewFixtureRun(
      FIXTURE,
      { status: 'schema_failed', record: RECORD },
      PAYLOAD_MAPS,
    );
    expect(schemaFailed.pass).toBe(true);

    const refusal = evaluateInterviewFixtureRun(
      FIXTURE,
      { status: 'refusal', record: RECORD },
      PAYLOAD_MAPS,
    );
    expect(refusal.pass).toBe(false);
    expect(refusal.withinPreRegistration).toBe(false);
  });
});
