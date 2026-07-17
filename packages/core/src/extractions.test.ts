import { describe, expect, it } from 'vitest';

import {
  extractionRunSchema,
  postingExtractBodySchema,
  postingRequirementsResponseSchema,
  requirementSchema,
} from './extractions.ts';

const run = {
  id: '7f0e6f5a-0000-4000-8000-000000000001',
  promptId: 'extract-requirements@v1',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  status: 'ok',
  attempt: 1,
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  latencyMs: 2100,
  createdAt: '2026-07-16T12:00:00.000Z',
};

describe('extraction wire contracts', () => {
  it('run schema requires per-run usage on the wire (RISKS T-03)', () => {
    expect(extractionRunSchema.parse(run)).toEqual(run);
    const withoutUsage: Partial<typeof run> = { ...run };
    delete withoutUsage.inputTokens;
    expect(extractionRunSchema.safeParse(withoutUsage).success).toBe(false);
  });

  it('requirement schema bounds confidence and allows unverified quotes', () => {
    const requirement = {
      id: '7f0e6f5a-0000-4000-8000-000000000002',
      kind: 'must_have',
      category: 'language',
      text: 'TypeScript experience',
      sourceQuote: '5+ years of TypeScript',
      quoteVerified: null,
      confidence: 0.9,
    };
    expect(requirementSchema.parse(requirement)).toEqual(requirement);
    expect(requirementSchema.safeParse({ ...requirement, confidence: 1.2 }).success).toBe(false);
    expect(requirementSchema.safeParse({ ...requirement, kind: 'optional' }).success).toBe(false);
  });

  it('extract body defaults force to false', () => {
    expect(postingExtractBodySchema.parse({})).toEqual({ force: false });
    expect(postingExtractBodySchema.parse({ force: true })).toEqual({ force: true });
  });

  it('requirements response admits the pre-extraction empty state', () => {
    expect(postingRequirementsResponseSchema.parse({ run: null, requirements: [] })).toEqual({
      run: null,
      requirements: [],
    });
  });
});
