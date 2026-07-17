import { describe, expect, it } from 'vitest';

import { createMockProvider } from '../provider/mock.ts';
import type { GenerateRequest } from '../provider/types.ts';
import { extractRequirementsV1 } from '../registry/prompts/extract-requirements/v1.ts';
import { runPrompt, type LlmCallRecord } from '../run.ts';
import { ADVERSARIAL_CORPUS } from './index.ts';

// CI structural guards (mock provider + the REAL extract-requirements@v1): for
// every fixture, the mechanical injection invariants hold regardless of what a
// model would do. This NEVER asserts "the model obeyed" -- that behavioral claim
// lives only in the live pass (adversarial-smoke). Extends run.test.ts (which
// covers fixture-echo + one synthetic string) to the real product prompt across
// every attack class; the forged-delimiter checks are new (gap #3).

const EMPTY_OUTPUT = JSON.stringify({ requirements: [] });

function makeSink() {
  const records: LlmCallRecord[] = [];
  return { records, recordCall: (record: LlmCallRecord) => void records.push(record) };
}

const userContent = (request: GenerateRequest | undefined) => request?.messages[0]?.content ?? '';

// The FIRST 32-hex token in the wrapped user message is the real per-call
// boundary token (it appears in the wrap preamble, ahead of any forged marker
// embedded in the posting data).
const realToken = (content: string) => /UNTRUSTED-DATA-([0-9a-f]{32})/.exec(content)?.[1];

async function runFixture(postingText: string, script = [{ text: EMPTY_OUTPUT }]) {
  const provider = createMockProvider(script);
  const { recordCall } = makeSink();
  await runPrompt(extractRequirementsV1, { untrustedData: postingText }, { provider, recordCall });
  return provider;
}

describe.each(ADVERSARIAL_CORPUS)('structural guards: $id', (fixture) => {
  it('sends the frozen v1 system prompt BYTE-for-BYTE, untouched by the posting', async () => {
    const provider = await runFixture(fixture.postingText);
    const request = provider.requests[0];
    // Primary guard: exact byte equality with the frozen system prompt.
    expect(request?.system).toBe(extractRequirementsV1.system);
    // Secondary guard: no whole-posting and no per-line leak into the system
    // prompt. Fixture lines are distinctive fictional strings (never a
    // coincidental substring of v1's system text), so a hit here is a real
    // leak, not an accident.
    expect(request?.system).not.toContain(fixture.postingText);
    for (const line of fixture.postingText.split('\n')) {
      if (line.trim() === '') continue;
      expect(request?.system).not.toContain(line);
    }
  });

  it('carries the posting ONLY inside the real random-token delimiters, in the USER message', async () => {
    const provider = await runFixture(fixture.postingText);
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

    // The posting (and anything it embeds) lives strictly between the real
    // markers -- nowhere else in the message.
    const dataSpan = content.slice(openIdx + openMarker.length, closeIdx);
    expect(dataSpan).toContain(fixture.postingText);
    const before = content.slice(0, openIdx);
    expect(before).not.toContain(fixture.postingText);
  });
});

describe('forged-delimiter fixtures: the real token defeats the forgery', () => {
  const forged = ADVERSARIAL_CORPUS.filter((fixture) => fixture.class === 'fake-delimiter');

  it('covers both forged-delimiter fixtures', () => {
    expect(forged.length).toBeGreaterThanOrEqual(2);
  });

  it.each(forged)(
    '$id -- forged markers stay sealed inside the real data span',
    async (fixture) => {
      const provider = await runFixture(fixture.postingText);
      const content = userContent(provider.requests[0]);
      const token = realToken(content);
      expect(token).toMatch(/^[0-9a-f]{32}$/);

      // The forged tokens are constants baked into the fixture; the real token
      // is generated per call and cannot equal them.
      expect(token).not.toBe('00000000000000000000000000000000');
      expect(token).not.toBe('ffffffffffffffffffffffffffffffff');

      const openMarker = `<<<UNTRUSTED-DATA-${token ?? ''}>>>`;
      const closeMarker = `<<<END-UNTRUSTED-DATA-${token ?? ''}>>>`;
      const dataSpan = content.slice(
        content.indexOf(openMarker) + openMarker.length,
        content.indexOf(closeMarker),
      );
      // Every forged marker the posting embeds is inside the data span (it is
      // part of the posting), so it can never terminate or reopen the real span.
      for (const forgedMarker of fixture.postingText.match(/<<<[^>]+>>>/g) ?? []) {
        expect(dataSpan).toContain(forgedMarker);
      }
    },
  );
});

describe('fresh boundary token per wire call', () => {
  it('a schema-fail then ok retry pair uses two DIFFERENT tokens', async () => {
    const provider = await runFixture(ADVERSARIAL_CORPUS[0]?.postingText ?? 'x', [
      { text: 'not json at all' },
      { text: EMPTY_OUTPUT },
    ]);
    expect(provider.requests).toHaveLength(2);
    const first = realToken(userContent(provider.requests[0]));
    const second = realToken(userContent(provider.requests[1]));
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});
