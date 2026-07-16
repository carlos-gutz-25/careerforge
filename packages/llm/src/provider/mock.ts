import type { GenerateRequest, GenerateResult, LlmProvider, LlmUsage } from './types.ts';

// The test default (ADR-0005 §4): pnpm test never makes a live call. The mock
// replays a script of responses in order and records every request it saw.

export interface MockResponse {
  text?: string;
  usage?: Partial<LlmUsage>;
  model?: string;
  stopReason?: GenerateResult['stopReason'];
  raw?: unknown;
}

export interface MockProvider extends LlmProvider {
  /** Every GenerateRequest received, in call order. */
  readonly requests: GenerateRequest[];
}

const DEFAULT_USAGE: LlmUsage = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

export function createMockProvider(script: MockResponse[]): MockProvider {
  const requests: GenerateRequest[] = [];
  let next = 0;
  return {
    name: 'mock',
    requests,
    generate(request: GenerateRequest): Promise<GenerateResult> {
      requests.push(request);
      const scripted = script[next];
      if (scripted === undefined) {
        // Exhaustion is loud: a test that calls more often than it scripted
        // has a bug, and a silent default would hide it.
        return Promise.reject(
          new Error(`mock provider script exhausted after ${String(next)} response(s)`),
        );
      }
      next += 1;
      const text = scripted.text ?? '';
      return Promise.resolve({
        text,
        usage: { ...DEFAULT_USAGE, ...scripted.usage },
        model: scripted.model ?? 'mock-model',
        stopReason: scripted.stopReason ?? 'end_turn',
        raw: scripted.raw ?? { mock: true, text },
      });
    },
  };
}
