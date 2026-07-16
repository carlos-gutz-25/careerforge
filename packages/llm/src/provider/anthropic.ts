// The ONLY module in the workspace that touches an LLM provider SDK — the
// eslint boundary wall (@anthropic-ai/* quarantine) enforces this everywhere
// else. Adapter stays thin per ADR-0005: map the request, map the response,
// no orchestration, no logging (the raw response travels in GenerateResult.raw
// for audit recording; it never goes to a log stream).
import Anthropic from '@anthropic-ai/sdk';

import type { GenerateRequest, GenerateResult, LlmProvider, LlmStopReason } from './types.ts';

export interface AnthropicProviderConfig {
  /** Read from validated env only (parseLlmEnv) — never argv, never logged. */
  apiKey: string;
  model: string;
  /**
   * Omitted by default, and undefined stays omitted on the wire:
   * current-generation models reject non-default sampling params with a 400
   * (ADR-0005 amendment). The knob exists for models that accept it.
   */
  temperature?: number;
}

// Structural client seam so unit tests inject a fake without network or key.
export interface AnthropicClientLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

function mapStopReason(stopReason: Anthropic.Message['stop_reason']): LlmStopReason {
  switch (stopReason) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export function createAnthropicProvider(
  config: AnthropicProviderConfig,
  client: AnthropicClientLike = new Anthropic({ apiKey: config.apiKey }),
): LlmProvider {
  return {
    name: 'anthropic',
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: config.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (config.temperature !== undefined) {
        params.temperature = config.temperature;
      }
      if (request.thinking === 'disabled') {
        // 'default' and omitted both mean: send no thinking field at all —
        // the model's own default (adaptive on current models) applies.
        params.thinking = { type: 'disabled' };
      }
      if (request.jsonSchema !== undefined) {
        params.output_config = {
          format: { type: 'json_schema', schema: request.jsonSchema },
        };
      }

      const response = await client.messages.create(params);

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
        },
        model: response.model,
        stopReason: mapStopReason(response.stop_reason),
        raw: response,
      };
    },
  };
}
