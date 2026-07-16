import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { createAnthropicProvider, type AnthropicClientLike } from './anthropic.ts';
import type { GenerateRequest } from './types.ts';

// Unit tests exercise the adapter's request/response mapping against an
// injected fake client — no network, no key, never part of a live path.

function makeMessage(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: '{"echo":"hi"}', citations: null }],
    model: 'claude-sonnet-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
    },
    ...overrides,
  } as Anthropic.Message;
}

function makeFakeClient(response: Anthropic.Message) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AnthropicClientLike = {
    messages: {
      create(params) {
        calls.push(params);
        return Promise.resolve(response);
      },
    },
  };
  return { client, calls };
}

const REQUEST: GenerateRequest = {
  system: 'static system prompt',
  messages: [{ role: 'user', content: 'user content' }],
  maxTokens: 4096,
};

describe('createAnthropicProvider', () => {
  it('maps model, max_tokens, system, and messages onto the wire request', async () => {
    const { client, calls } = makeFakeClient(makeMessage());
    const provider = createAnthropicProvider(
      { apiKey: 'test-key', model: 'claude-sonnet-5' },
      client,
    );

    await provider.generate(REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: 'static system prompt',
      messages: [{ role: 'user', content: 'user content' }],
    });
  });

  it('omits temperature entirely when unset — current models 400 on non-default values', async () => {
    const { client, calls } = makeFakeClient(makeMessage());
    const provider = createAnthropicProvider(
      { apiKey: 'test-key', model: 'claude-sonnet-5' },
      client,
    );

    await provider.generate(REQUEST);

    expect(calls[0] !== undefined && 'temperature' in calls[0]).toBe(false);
  });

  it('passes temperature through when configured (models that accept it)', async () => {
    const { client, calls } = makeFakeClient(makeMessage());
    const provider = createAnthropicProvider(
      { apiKey: 'test-key', model: 'some-legacy-model', temperature: 0 },
      client,
    );

    await provider.generate(REQUEST);

    expect(calls[0]?.temperature).toBe(0);
  });

  it("sends no thinking field for omitted and 'default'; maps 'disabled' explicitly", async () => {
    const { client, calls } = makeFakeClient(makeMessage());
    const provider = createAnthropicProvider(
      { apiKey: 'test-key', model: 'claude-sonnet-5' },
      client,
    );

    await provider.generate(REQUEST);
    await provider.generate({ ...REQUEST, thinking: 'default' });
    await provider.generate({ ...REQUEST, thinking: 'disabled' });

    expect(calls[0] !== undefined && 'thinking' in calls[0]).toBe(false);
    expect(calls[1] !== undefined && 'thinking' in calls[1]).toBe(false);
    expect(calls[2]?.thinking).toEqual({ type: 'disabled' });
  });

  it('maps jsonSchema onto output_config.format (structured outputs)', async () => {
    const { client, calls } = makeFakeClient(makeMessage());
    const provider = createAnthropicProvider(
      { apiKey: 'test-key', model: 'claude-sonnet-5' },
      client,
    );
    const schema = { type: 'object', properties: {}, additionalProperties: false };

    await provider.generate({ ...REQUEST, jsonSchema: schema });

    expect(calls[0]?.output_config).toEqual({
      format: { type: 'json_schema', schema },
    });
  });

  it('concatenates text blocks, ignores non-text blocks, and returns the raw response', async () => {
    const message = makeMessage({
      content: [
        { type: 'text', text: '{"a":', citations: null },
        { type: 'text', text: '1}', citations: null },
      ] as Anthropic.Message['content'],
    });
    const { client } = makeFakeClient(message);
    const provider = createAnthropicProvider(
      { apiKey: 'test-key', model: 'claude-sonnet-5' },
      client,
    );

    const result = await provider.generate(REQUEST);

    expect(result.text).toBe('{"a":1}');
    expect(result.raw).toBe(message);
    expect(result.model).toBe('claude-sonnet-5');
  });

  it('maps usage fields, defaulting null cache counters to zero', async () => {
    const message = makeMessage({
      usage: {
        input_tokens: 42,
        output_tokens: 7,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      } as Anthropic.Message['usage'],
    });
    const { client } = makeFakeClient(message);
    const provider = createAnthropicProvider(
      { apiKey: 'test-key', model: 'claude-sonnet-5' },
      client,
    );

    const result = await provider.generate(REQUEST);

    expect(result.usage).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
  });

  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
  ] as const)("maps stop_reason '%s' to '%s'", async (wire, mapped) => {
    const { client } = makeFakeClient(
      makeMessage({ stop_reason: wire as Anthropic.Message['stop_reason'] }),
    );
    const provider = createAnthropicProvider(
      { apiKey: 'test-key', model: 'claude-sonnet-5' },
      client,
    );

    const result = await provider.generate(REQUEST);

    expect(result.stopReason).toBe(mapped);
  });
});
