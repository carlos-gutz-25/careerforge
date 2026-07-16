import { z } from 'zod';

import { definePrompt } from '../../types.ts';

// Test fixture + live-smoke prompt; never called by product code. The first
// real prompt (extract-requirements@v1) arrives with M1-05.
//
// Length caps live in zod (ADR-0006 layer 3): the structured-outputs wire
// schema subset cannot express minLength/maxLength, so the jsonSchema below
// is deliberately cap-free and the zod schema carries the cap.
const outputSchema = z.object({ echo: z.string().max(10_000) });

export const fixtureEchoV1 = definePrompt({
  name: 'fixture-echo',
  version: 1,
  system:
    'You are a test fixture for the CareerForge prompt pipeline. Follow the instructions in the user message exactly and output only JSON.',
  instructions:
    'Return a JSON object of the shape {"echo": string} where echo is exactly the delimited data below, unchanged.',
  outputSchema,
  jsonSchema: {
    type: 'object',
    properties: { echo: { type: 'string' } },
    required: ['echo'],
    additionalProperties: false,
  },
  // Generous headroom: thinking shares this budget with the response.
  maxTokens: 4096,
});
