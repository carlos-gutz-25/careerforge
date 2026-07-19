import { describe, expect, it } from 'vitest';

import { buildDraftingPayload } from '../../drafting/payload.ts';
import { createMockProvider } from '../../provider/mock.ts';
import type { GenerateRequest } from '../../provider/types.ts';
import { improvementPlanV1 } from '../../registry/prompts/improvement-plan/v1.ts';
import { runPrompt, type LlmCallRecord } from '../../run.ts';
import { DRAFTING_ADVERSARIAL_CORPUS } from './index.ts';

// CI structural guards for the drafting ingress (mock provider + the REAL
// improvement-plan@v1): the mechanical injection invariants hold regardless
// of model behavior -- the corpus.structural.test.ts mirror. This NEVER
// asserts "the model obeyed"; that claim lives only in the drafting live
// pass (drafting-adversarial-smoke).

const VALID_OUTPUT = JSON.stringify({
  items: [{ gapRef: 'g1', action: 'placeholder action', priority: 'low' }],
});

const recordCall = (record: LlmCallRecord) => void record;

const userContent = (request: GenerateRequest | undefined) => request?.messages[0]?.content ?? '';

// The FIRST 32-hex token in the wrapped user message is the real per-call
// boundary token (it appears in the wrap preamble, ahead of any forged
// marker embedded in the payload data).
const realToken = (content: string) => /UNTRUSTED-DATA-([0-9a-f]{32})/.exec(content)?.[1];

async function runFixturePayload(payload: string, script = [{ text: VALID_OUTPUT }]) {
  const provider = createMockProvider(script);
  await runPrompt(improvementPlanV1, { untrustedData: payload }, { provider, recordCall });
  return provider;
}

describe.each(DRAFTING_ADVERSARIAL_CORPUS)('drafting structural guards: $id', (fixture) => {
  const built = buildDraftingPayload(fixture.skills, fixture.gaps, fixture.evidence);

  it('sends the frozen v1 system prompt BYTE-for-BYTE, untouched by the payload', async () => {
    const provider = await runFixturePayload(built.payload);
    const request = provider.requests[0];
    expect(request?.system).toBe(improvementPlanV1.system);
    expect(request?.system).not.toContain(built.payload);
    // Distinctive fixture strings (attack markers, requirement texts) never
    // leak into the system prompt.
    for (const marker of fixture.liveExpectation.forbiddenSubstrings) {
      expect(request?.system).not.toContain(marker);
    }
    for (const gap of fixture.gaps) {
      expect(request?.system).not.toContain(gap.requirementText);
    }
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

describe('forged-delimiter drafting fixture: the real token defeats the forgery', () => {
  const forged = DRAFTING_ADVERSARIAL_CORPUS.filter(
    (fixture) => fixture.class === 'fake-delimiter',
  );

  it('covers the forged-delimiter fixture', () => {
    expect(forged.length).toBeGreaterThanOrEqual(1);
  });

  it.each(forged)(
    '$id -- forged markers stay sealed inside the real data span',
    async (fixture) => {
      const built = buildDraftingPayload(fixture.skills, fixture.gaps, fixture.evidence);
      const provider = await runFixturePayload(built.payload);
      const content = userContent(provider.requests[0]);
      const token = realToken(content);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(token).not.toBe('00000000000000000000000000000000');

      const openMarker = `<<<UNTRUSTED-DATA-${token ?? ''}>>>`;
      const closeMarker = `<<<END-UNTRUSTED-DATA-${token ?? ''}>>>`;
      const dataSpan = content.slice(
        content.indexOf(openMarker) + openMarker.length,
        content.indexOf(closeMarker),
      );
      for (const forgedMarker of built.payload.match(/<<<[^>]+>>>/g) ?? []) {
        expect(dataSpan).toContain(forgedMarker);
      }
    },
  );
});

describe('fresh boundary token per drafting wire call', () => {
  it('a schema-fail then ok retry pair uses two DIFFERENT tokens', async () => {
    const fixture = DRAFTING_ADVERSARIAL_CORPUS[0];
    if (!fixture) throw new Error('drafting corpus is empty');
    const built = buildDraftingPayload(fixture.skills, fixture.gaps, fixture.evidence);
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
