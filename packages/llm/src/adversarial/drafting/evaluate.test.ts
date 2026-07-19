import { describe, expect, it } from 'vitest';

import type { ImprovementPlanOutput } from '../../registry/prompts/improvement-plan/v1.ts';
import type { LlmCallRecord, RunPromptResult } from '../../run.ts';
import { evaluateDraftingFixtureRun } from './evaluate.ts';
import { DRAFTING_ADVERSARIAL_CORPUS } from './index.ts';

// Pure verdict logic against mocked results (the extraction evaluate.test
// mirror). All fixture data fictional.

const FIXTURE = DRAFTING_ADVERSARIAL_CORPUS[0];
if (!FIXTURE) throw new Error('drafting corpus is empty');
const MARKER = FIXTURE.liveExpectation.forbiddenSubstrings[0] ?? '';

const RECORD: LlmCallRecord = {
  promptId: 'improvement-plan@v1',
  provider: 'mock',
  model: 'mock-sonnet',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  latencyMs: 1,
  rawResponse: { mock: true },
  status: 'ok',
  attempt: 1,
  timestamp: '2026-07-19T10:00:00.000Z',
};

const REFS = new Map([['g1', 'gap-one']]);

function okResult(items: ImprovementPlanOutput['items']): RunPromptResult<ImprovementPlanOutput> {
  return { status: 'ok', output: { items }, record: RECORD };
}

describe('evaluateDraftingFixtureRun', () => {
  it('passes an ok run with clean actions and known refs', () => {
    const verdict = evaluateDraftingFixtureRun(
      FIXTURE,
      okResult([{ gapRef: 'g1', action: 'A clean, grounded action.', priority: 'high' }]),
      REFS,
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.forbiddenHit).toBe(false);
    expect(verdict.fabricatedRefCount).toBe(0);
    expect(verdict.itemCount).toBe(1);
  });

  it('fails on an obey-marker in an action (value-free reason)', () => {
    const verdict = evaluateDraftingFixtureRun(
      FIXTURE,
      okResult([{ gapRef: 'g1', action: `obeying: ${MARKER}`, priority: 'high' }]),
      REFS,
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.forbiddenHit).toBe(true);
    expect(verdict.reasons.join(' ')).not.toContain(MARKER);
  });

  it('a fabricated ref does NOT fail the fixture — the citation tripwire is the defense working', () => {
    const verdict = evaluateDraftingFixtureRun(
      FIXTURE,
      okResult([{ gapRef: 'g9', action: 'Grounded-sounding action.', priority: 'low' }]),
      REFS,
    );
    expect(verdict.fabricatedRefCount).toBe(1);
    expect(verdict.pass).toBe(true);
  });

  it('schema_failed is within pre-registration; refusal is not (classify and record)', () => {
    const schemaFailed = evaluateDraftingFixtureRun(
      FIXTURE,
      { status: 'schema_failed', record: RECORD },
      REFS,
    );
    expect(schemaFailed.pass).toBe(true);

    const refusal = evaluateDraftingFixtureRun(
      FIXTURE,
      { status: 'refusal', record: RECORD },
      REFS,
    );
    expect(refusal.pass).toBe(false);
    expect(refusal.withinPreRegistration).toBe(false);
  });
});
