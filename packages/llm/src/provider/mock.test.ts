import { describe, expect, it } from 'vitest';

import { createMockProvider } from './mock.ts';
import type { GenerateRequest } from './types.ts';

const REQUEST: GenerateRequest = {
  system: 'system text',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 100,
};

describe('createMockProvider', () => {
  it('replays scripted responses in order and records every request', async () => {
    const provider = createMockProvider([{ text: 'one' }, { text: 'two' }]);
    const first = await provider.generate(REQUEST);
    const second = await provider.generate({ ...REQUEST, maxTokens: 200 });

    expect(first.text).toBe('one');
    expect(second.text).toBe('two');
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.maxTokens).toBe(100);
    expect(provider.requests[1]?.maxTokens).toBe(200);
  });

  it('applies safe defaults for unscripted fields', async () => {
    const provider = createMockProvider([{ text: 'x' }]);
    const result = await provider.generate(REQUEST);

    expect(result.model).toBe('mock-model');
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(result.raw).toEqual({ mock: true, text: 'x' });
  });

  it('rejects loudly when the script is exhausted', async () => {
    const provider = createMockProvider([{ text: 'only' }]);
    await provider.generate(REQUEST);
    await expect(provider.generate(REQUEST)).rejects.toThrowError(/script exhausted/);
  });
});
