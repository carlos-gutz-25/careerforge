import { describe, expect, it } from 'vitest';

import { buildDraftingPayload } from '../../drafting/payload.ts';
import { createMockProvider } from '../../provider/mock.ts';
import type { GenerateRequest } from '../../provider/types.ts';
import { improvementPlanV1 } from '../../registry/prompts/improvement-plan/v1.ts';
import { improvementPlanV2 } from '../../registry/prompts/improvement-plan/v2.ts';
import type { PromptVersion } from '../../registry/types.ts';
import { runPrompt, type LlmCallRecord } from '../../run.ts';
import { DRAFTING_ADVERSARIAL_CORPUS } from './index.ts';

// CI structural guards for the drafting ingress (mock provider + the REAL
// improvement-plan prompts): the mechanical injection invariants hold
// regardless of model behavior -- the corpus.structural.test.ts mirror. This
// NEVER asserts "the model obeyed"; that claim lives only in the drafting live
// pass (drafting-adversarial-smoke).
//
// M7-02 (D7): the matrix runs BOTH registered versions. Production keeps
// calling v1 until M7-03 flips the selector, so neither the version in service
// today nor the one it calls next may have a weakened invariant. A single mock
// VALID_OUTPUT works for both: `recommendations: []` is REQUIRED under v2 and
// silently STRIPPED under v1's non-strict item schema.
const VERSIONS: readonly PromptVersion[] = [improvementPlanV1, improvementPlanV2];

const VALID_OUTPUT = JSON.stringify({
  items: [{ gapRef: 'g1', action: 'placeholder action', priority: 'low', recommendations: [] }],
});

const recordCall = (record: LlmCallRecord) => void record;

const userContent = (request: GenerateRequest | undefined) => request?.messages[0]?.content ?? '';

// The FIRST 32-hex token in the wrapped user message is the real per-call
// boundary token (it appears in the wrap preamble, ahead of any forged
// marker embedded in the payload data).
const realToken = (content: string) => /UNTRUSTED-DATA-([0-9a-f]{32})/.exec(content)?.[1];

async function runFixturePayload(
  prompt: PromptVersion,
  payload: string,
  script = [{ text: VALID_OUTPUT }],
) {
  const provider = createMockProvider(script);
  await runPrompt(prompt, { untrustedData: payload }, { provider, recordCall });
  return provider;
}

describe.each(VERSIONS)('drafting structural guards [$id]', (prompt) => {
  describe.each(DRAFTING_ADVERSARIAL_CORPUS)('$id', (fixture) => {
    const built = buildDraftingPayload(fixture.skills, fixture.gaps, fixture.evidence);

    it('sends the frozen system prompt BYTE-for-BYTE, untouched by the payload', async () => {
      const provider = await runFixturePayload(prompt, built.payload);
      const request = provider.requests[0];
      expect(request?.system).toBe(prompt.system);
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
      const provider = await runFixturePayload(prompt, built.payload);
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

  describe('forged-delimiter drafting fixtures: the real token defeats the forgery', () => {
    const forged = DRAFTING_ADVERSARIAL_CORPUS.filter(
      (fixture) => fixture.class === 'fake-delimiter',
    );

    it('covers at least one forged-delimiter fixture', () => {
      expect(forged.length).toBeGreaterThanOrEqual(1);
    });

    it.each(forged)(
      '$id -- forged markers stay sealed inside the real data span',
      async (fixture) => {
        const built = buildDraftingPayload(fixture.skills, fixture.gaps, fixture.evidence);
        const provider = await runFixturePayload(prompt, built.payload);
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
      const provider = await runFixturePayload(prompt, built.payload, [
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
});
