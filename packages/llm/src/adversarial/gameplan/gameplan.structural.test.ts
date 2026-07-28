import { describe, expect, it } from 'vitest';

import { buildGameplanPayload } from '../../drafting/gameplan-payload.ts';
import { createMockProvider } from '../../provider/mock.ts';
import type { GenerateRequest } from '../../provider/types.ts';
import { applicationGameplanV1 } from '../../registry/prompts/application-gameplan/v1.ts';
import { runPrompt, type LlmCallRecord } from '../../run.ts';
import { GAMEPLAN_ADVERSARIAL_CORPUS } from './index.ts';

// CI structural guards for the gameplan ingress (mock provider + the REAL
// application-gameplan@v1 prompt): the mechanical injection invariants hold
// regardless of model behavior (the compose.structural.test.ts mirror). This
// NEVER asserts "the model obeyed"; that claim lives only in the live pass
// (gameplan-adversarial-smoke). One registered version, so describe.each runs over
// the corpus alone. The forged-marker-defeat leg is NOT written here: no
// fake-delimiter fixture exists yet - M7-08 owes it together with its fixture.

const VALID_OUTPUT = JSON.stringify({
  strategySummary: 'Lead with the strongest evidence and be honest about the gaps.',
  phaseStrategies: {
    apply: 'Tailor the resume to the must-have work.',
    screen: 'Prepare a crisp two-minute intro.',
    interview: 'Rehearse the STAR stories out loud.',
    offer: 'Research the compensation band first.',
  },
  stories: [
    {
      requirementRef: 'r1',
      situation: 'A fictional situation.',
      task: 'A fictional task.',
      action: 'A fictional action.',
      result: 'A fictional result.',
      citationRefs: ['e1'],
    },
  ],
});

const recordCall = (record: LlmCallRecord) => void record;

const userContent = (request: GenerateRequest | undefined) => request?.messages[0]?.content ?? '';

// The FIRST 32-hex token in the wrapped user message is the real per-call boundary
// token (it appears in the wrap preamble, ahead of any content in the payload).
const realToken = (content: string) => /UNTRUSTED-DATA-([0-9a-f]{32})/.exec(content)?.[1];

async function runFixturePayload(payload: string, script = [{ text: VALID_OUTPUT }]) {
  const provider = createMockProvider(script);
  await runPrompt(applicationGameplanV1, { untrustedData: payload }, { provider, recordCall });
  return provider;
}

it('the shared VALID_OUTPUT mock parses under the real application-gameplan@v1 output schema', () => {
  expect(applicationGameplanV1.outputSchema.safeParse(JSON.parse(VALID_OUTPUT)).success).toBe(true);
});

describe.each(GAMEPLAN_ADVERSARIAL_CORPUS)('gameplan structural guards [$id]', (fixture) => {
  const built = buildGameplanPayload(
    fixture.skills,
    fixture.requirements,
    fixture.evidence,
    fixture.improvementPlan,
  );

  it('sends the frozen system prompt BYTE-for-BYTE, untouched by the payload', async () => {
    const provider = await runFixturePayload(built.payload);
    const request = provider.requests[0];
    expect(request?.system).toBe(applicationGameplanV1.system);
    expect(request?.system).not.toContain(built.payload);
  });

  it('carries the payload ONLY inside the real random-token delimiters, in the USER message', async () => {
    const provider = await runFixturePayload(built.payload);
    const request = provider.requests[0];
    expect(request?.messages).toHaveLength(1);
    expect(request?.messages[0]?.role).toBe('user');

    const content = userContent(request);
    const token = realToken(content);
    expect(token, 'a 32-hex boundary token must be present').toMatch(/^[0-9a-f]{32}$/);

    const openMarker = `<<<UNTRUSTED-DATA-${token ?? ''}>>>`;
    const closeMarker = `<<<END-UNTRUSTED-DATA-${token ?? ''}>>>`;
    const openIdx = content.indexOf(openMarker);
    const closeIdx = content.indexOf(closeMarker);
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(openIdx);

    const dataSpan = content.slice(openIdx + openMarker.length, closeIdx);
    expect(dataSpan).toContain(built.payload);
    expect(content.slice(0, openIdx)).not.toContain(built.payload);
  });
});

describe('fresh boundary token per gameplan wire call', () => {
  it('a schema-fail then ok retry pair uses two DIFFERENT tokens', async () => {
    const fixture = GAMEPLAN_ADVERSARIAL_CORPUS[0];
    if (!fixture) throw new Error('gameplan corpus is empty');
    const built = buildGameplanPayload(
      fixture.skills,
      fixture.requirements,
      fixture.evidence,
      fixture.improvementPlan,
    );
    const provider = await runFixturePayload(built.payload, [
      { text: 'not json at all' },
      { text: VALID_OUTPUT },
    ]);
    expect(provider.requests).toHaveLength(2);
    const first = realToken(userContent(provider.requests[0]));
    const second = realToken(userContent(provider.requests[1]));
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});
