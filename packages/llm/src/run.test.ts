import { describe, expect, it } from 'vitest';

import { createMockProvider } from './provider/mock.ts';
import type { GenerateRequest, LlmProvider } from './provider/types.ts';
import { fixtureEchoV1 } from './registry/prompts/fixture-echo/v1.ts';
import { runPrompt, type LlmCallRecord } from './run.ts';

// A deterministic clock: each call advances 25ms, so a single attempt's
// latency (start → end) is exactly 25.
function makeClock() {
  let t = 1000;
  return () => {
    t += 25;
    return t;
  };
}

function makeSink() {
  const records: LlmCallRecord[] = [];
  return {
    records,
    recordCall: (record: LlmCallRecord) => {
      records.push(record);
    },
  };
}

const boundaryToken = (request: GenerateRequest | undefined) =>
  /UNTRUSTED-DATA-([0-9a-f]{32})/.exec(request?.messages[0]?.content ?? '')?.[1];

describe('runPrompt', () => {
  it('records a complete LlmCallRecord on success — prompt_id, model, token usage, latency, raw response (the M1-04 AC)', async () => {
    const raw = { id: 'msg_1', kept: 'verbatim' };
    const provider = createMockProvider([
      {
        text: JSON.stringify({ echo: 'hello' }),
        usage: { inputTokens: 321, outputTokens: 45, cacheReadInputTokens: 12 },
        model: 'mock-sonnet',
        raw,
      },
    ]);
    const { records, recordCall } = makeSink();

    const result = await runPrompt(
      fixtureEchoV1,
      { untrustedData: 'hello' },
      { provider, recordCall, now: makeClock() },
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output).toEqual({ echo: 'hello' });
    }
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      promptId: 'fixture-echo@v1',
      provider: 'mock',
      model: 'mock-sonnet',
      usage: {
        inputTokens: 321,
        outputTokens: 45,
        cacheReadInputTokens: 12,
        cacheCreationInputTokens: 0,
      },
      latencyMs: 25,
      rawResponse: raw,
      status: 'ok',
      attempt: 1,
    });
    expect(Number.isNaN(Date.parse(records[0]?.timestamp ?? ''))).toBe(false);
  });

  it('sends the static system prompt untouched and puts the wrapped data in the USER message only', async () => {
    const provider = createMockProvider([{ text: JSON.stringify({ echo: 'data' }) }]);
    const { recordCall } = makeSink();

    await runPrompt(fixtureEchoV1, { untrustedData: 'data <injection>' }, { provider, recordCall });

    const request = provider.requests[0];
    expect(request?.system).toBe(fixtureEchoV1.system);
    expect(request?.system).not.toContain('injection');
    expect(request?.messages).toHaveLength(1);
    expect(request?.messages[0]?.role).toBe('user');
    expect(request?.messages[0]?.content).toContain(fixtureEchoV1.instructions);
    expect(request?.messages[0]?.content).toContain('data <injection>');
    expect(boundaryToken(request)).toBeDefined();
    expect(request?.maxTokens).toBe(fixtureEchoV1.maxTokens);
    expect(request?.jsonSchema).toBe(fixtureEchoV1.jsonSchema);
  });

  it('retries once on schema failure with a FRESH boundary token, then succeeds', async () => {
    const provider = createMockProvider([
      { text: 'not json at all' },
      { text: JSON.stringify({ echo: 'second try' }) },
    ]);
    const { records, recordCall } = makeSink();

    const result = await runPrompt(fixtureEchoV1, { untrustedData: 'x' }, { provider, recordCall });

    expect(result.status).toBe('ok');
    expect(provider.requests).toHaveLength(2);
    expect(records.map((r) => [r.attempt, r.status])).toEqual([
      [1, 'schema_failed'],
      [2, 'ok'],
    ]);
    const firstToken = boundaryToken(provider.requests[0]);
    const secondToken = boundaryToken(provider.requests[1]);
    expect(firstToken).toBeDefined();
    expect(secondToken).toBeDefined();
    expect(firstToken).not.toBe(secondToken);
  });

  it('returns schema_failed after the single retry is also unparseable — both attempts recorded', async () => {
    const provider = createMockProvider([
      { text: '{"wrong": true}' },
      { text: 'still not the shape' },
    ]);
    const { records, recordCall } = makeSink();

    const result = await runPrompt(fixtureEchoV1, { untrustedData: 'x' }, { provider, recordCall });

    expect(result.status).toBe('schema_failed');
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.status === 'schema_failed')).toBe(true);
    if (result.status === 'schema_failed') {
      expect(result.record.attempt).toBe(2);
    }
  });

  it('surfaces a refusal as its own status — one call, no retry', async () => {
    const provider = createMockProvider([{ text: '', stopReason: 'refusal' }]);
    const { records, recordCall } = makeSink();

    const result = await runPrompt(fixtureEchoV1, { untrustedData: 'x' }, { provider, recordCall });

    expect(result.status).toBe('refusal');
    expect(provider.requests).toHaveLength(1);
    expect(records.map((r) => r.status)).toEqual(['refusal']);
  });

  it('classifies truncation as max_tokens (a config bug), NEVER as schema_failed, even when the partial text is invalid JSON', async () => {
    const provider = createMockProvider([
      { text: '{"echo": "truncated mid-', stopReason: 'max_tokens' },
    ]);
    const { records, recordCall } = makeSink();

    const result = await runPrompt(fixtureEchoV1, { untrustedData: 'x' }, { provider, recordCall });

    expect(result.status).toBe('max_tokens');
    expect(provider.requests).toHaveLength(1);
    expect(records.map((r) => r.status)).toEqual(['max_tokens']);
  });

  it('records an error outcome with value-free fields, then rethrows the provider error', async () => {
    const boom = new Error('network down');
    const provider: LlmProvider = {
      name: 'anthropic',
      generate: () => Promise.reject(boom),
    };
    const { records, recordCall } = makeSink();

    await expect(
      runPrompt(fixtureEchoV1, { untrustedData: 'x' }, { provider, recordCall, now: makeClock() }),
    ).rejects.toBe(boom);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      promptId: 'fixture-echo@v1',
      provider: 'anthropic',
      model: 'unknown',
      status: 'error',
      attempt: 1,
      latencyMs: 25,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      rawResponse: { error: 'Error' },
    });
  });

  it('awaits an async sink so no record can be dropped', async () => {
    const provider = createMockProvider([{ text: JSON.stringify({ echo: 'x' }) }]);
    const seen: string[] = [];

    await runPrompt(
      fixtureEchoV1,
      { untrustedData: 'x' },
      {
        provider,
        recordCall: async (record) => {
          await Promise.resolve();
          seen.push(record.status);
        },
      },
    );

    expect(seen).toEqual(['ok']);
  });
});
