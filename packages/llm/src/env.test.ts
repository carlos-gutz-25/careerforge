import { describe, expect, it } from 'vitest';

import { parseLlmEnv } from './env.ts';

describe('parseLlmEnv', () => {
  it('accepts a valid environment and applies the model default', () => {
    const env = parseLlmEnv({ ANTHROPIC_API_KEY: 'fictional-test-key' });
    expect(env.ANTHROPIC_API_KEY).toBe('fictional-test-key');
    expect(env.LLM_MODEL).toBe('claude-sonnet-5');
  });

  it('honors an explicit model override', () => {
    const env = parseLlmEnv({ ANTHROPIC_API_KEY: 'fictional-test-key', LLM_MODEL: 'other-model' });
    expect(env.LLM_MODEL).toBe('other-model');
  });

  it('fails fast when the key is missing, naming the variable', () => {
    expect(() => parseLlmEnv({})).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it('rejects an empty key without echoing any value', () => {
    let message = '';
    try {
      parseLlmEnv({ ANTHROPIC_API_KEY: '' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('ANTHROPIC_API_KEY');
    // Names only, never values: nothing that looks like a key may appear.
    expect(message).not.toContain('sk-');
  });

  it('ignores unrelated variables', () => {
    expect(() =>
      parseLlmEnv({ ANTHROPIC_API_KEY: 'fictional-test-key', PATH: '/usr/bin' }),
    ).not.toThrow();
  });
});
