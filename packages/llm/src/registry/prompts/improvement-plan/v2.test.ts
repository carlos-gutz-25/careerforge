import { describe, expect, it } from 'vitest';

import { createMockProvider } from '../../../provider/mock.ts';
import { runPrompt, type LlmCallRecord } from '../../../run.ts';
import { improvementPlanV2 } from './v2.ts';

// All fixture data is fictional (RISKS P-01). NUL is written as the visible
// six-character \u0000 escape (source-byte law), never a raw byte.

const VALID_RECOMMENDATION = {
  kind: 'resource',
  title: 'The official Kubernetes documentation',
  rationale: 'Directly covers the pod-scheduling concepts named in the gap evidence.',
  expectedBenefit: 'A working mental model of scheduling, enough to speak to it in an interview.',
};

const VALID_ITEM = {
  gapRef: 'g1',
  action: 'Publish a fictional k8s lab writeup.',
  priority: 'high',
  recommendations: [VALID_RECOMMENDATION],
};

function makeSink() {
  const records: LlmCallRecord[] = [];
  return { records, recordCall: (record: LlmCallRecord) => void records.push(record) };
}

async function run(text: string) {
  const provider = createMockProvider([{ text }]);
  const { records, recordCall } = makeSink();
  const result = await runPrompt(
    improvementPlanV2,
    { untrustedData: '{"profileSkills":[],"gaps":[]}' },
    { provider, recordCall },
  );
  return { result, records, provider };
}

describe('improvement-plan@v2 module shape', () => {
  it('registers as improvement-plan@v2 with thinking disabled and the 8192 budget', () => {
    expect(improvementPlanV2.id).toBe('improvement-plan@v2');
    expect(improvementPlanV2.thinking).toBe('disabled');
    expect(improvementPlanV2.maxTokens).toBe(8192);
  });

  it('is frozen - the deep-freeze law holds down into jsonSchema', () => {
    expect(Object.isFrozen(improvementPlanV2)).toBe(true);
    expect(Object.isFrozen(improvementPlanV2.jsonSchema)).toBe(true);
    expect(
      Object.isFrozen((improvementPlanV2.jsonSchema as { properties: unknown }).properties),
    ).toBe(true);
  });

  it('jsonSchema twin: additionalProperties false at all levels; priority + kind enums match core', () => {
    const schema = improvementPlanV2.jsonSchema as {
      additionalProperties: boolean;
      properties: {
        items: {
          items: {
            additionalProperties: boolean;
            required: string[];
            properties: {
              priority: { enum: string[] };
              recommendations: {
                items: { additionalProperties: boolean; properties: { kind: { enum: string[] } } };
              };
            };
          };
        };
      };
    };
    const item = schema.properties.items.items;
    expect(schema.additionalProperties).toBe(false);
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.priority.enum).toEqual(['high', 'medium', 'low']);
    expect(item.properties.recommendations.items.additionalProperties).toBe(false);
    expect(item.properties.recommendations.items.properties.kind.enum).toEqual([
      'resource',
      'certification',
      'demo_project',
      'practice',
    ]);
    // recommendations is forced by structured outputs (required on the item).
    expect(item.required).toContain('recommendations');
  });
});

describe('improvement-plan@v2 output validation (caps live in zod)', () => {
  it('parses items with 0, 1, and 2 recommendations', async () => {
    const items = [
      { ...VALID_ITEM, recommendations: [] },
      { ...VALID_ITEM, recommendations: [VALID_RECOMMENDATION] },
      {
        ...VALID_ITEM,
        recommendations: [VALID_RECOMMENDATION, { ...VALID_RECOMMENDATION, kind: 'practice' }],
      },
    ];
    const { result } = await run(JSON.stringify({ items }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.items).toHaveLength(3);
      expect(result.output.items[0]?.recommendations).toEqual([]);
      expect(result.output.items[2]?.recommendations).toHaveLength(2);
    }
  });

  it('lowercases stray priority and kind casing instead of paying a retry', async () => {
    const { result } = await run(
      JSON.stringify({
        items: [
          {
            ...VALID_ITEM,
            priority: 'HIGH',
            recommendations: [{ ...VALID_RECOMMENDATION, kind: 'DEMO_PROJECT' }],
          },
        ],
      }),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.items[0]?.priority).toBe('high');
      expect(result.output.items[0]?.recommendations[0]?.kind).toBe('demo_project');
    }
  });

  it('rejects malformed recommendation shapes and the whole-plan cap', async () => {
    const nul = String.fromCharCode(0);
    const bad = [
      // 3 recommendations on one item (per-array max 2)
      {
        items: [
          {
            ...VALID_ITEM,
            recommendations: [
              VALID_RECOMMENDATION,
              { ...VALID_RECOMMENDATION, kind: 'practice' },
              { ...VALID_RECOMMENDATION, kind: 'certification' },
            ],
          },
        ],
      },
      // 13 recommendations across items (superRefine <= 12): 7 items x 2 = 14
      {
        items: Array.from({ length: 7 }, () => ({
          ...VALID_ITEM,
          recommendations: [VALID_RECOMMENDATION, { ...VALID_RECOMMENDATION, kind: 'practice' }],
        })),
      },
      // title 121 chars
      {
        items: [
          { ...VALID_ITEM, recommendations: [{ ...VALID_RECOMMENDATION, title: 'x'.repeat(121) }] },
        ],
      },
      // rationale 301 chars
      {
        items: [
          {
            ...VALID_ITEM,
            recommendations: [{ ...VALID_RECOMMENDATION, rationale: 'x'.repeat(301) }],
          },
        ],
      },
      // expectedBenefit 301 chars
      {
        items: [
          {
            ...VALID_ITEM,
            recommendations: [{ ...VALID_RECOMMENDATION, expectedBenefit: 'x'.repeat(301) }],
          },
        ],
      },
      // empty title
      {
        items: [{ ...VALID_ITEM, recommendations: [{ ...VALID_RECOMMENDATION, title: '' }] }],
      },
      // U+0000 in each of the three recommendation text fields
      {
        items: [
          { ...VALID_ITEM, recommendations: [{ ...VALID_RECOMMENDATION, title: 'a' + nul + 'b' }] },
        ],
      },
      {
        items: [
          {
            ...VALID_ITEM,
            recommendations: [{ ...VALID_RECOMMENDATION, rationale: 'a' + nul + 'b' }],
          },
        ],
      },
      {
        items: [
          {
            ...VALID_ITEM,
            recommendations: [{ ...VALID_RECOMMENDATION, expectedBenefit: 'a' + nul + 'b' }],
          },
        ],
      },
      // missing recommendations key
      { items: [{ gapRef: 'g1', action: 'Do the thing.', priority: 'high' }] },
      // bad kind value
      {
        items: [{ ...VALID_ITEM, recommendations: [{ ...VALID_RECOMMENDATION, kind: 'webinar' }] }],
      },
    ];
    for (const output of bad) {
      const provider = createMockProvider([
        { text: JSON.stringify(output) },
        { text: JSON.stringify(output) },
      ]);
      const { recordCall } = makeSink();
      const result = await runPrompt(
        improvementPlanV2,
        { untrustedData: '{}' },
        { provider, recordCall },
      );
      expect(result.status).toBe('schema_failed');
    }
  });

  it('strips an unknown recommendation key rather than rejecting it (non-strict zod, the strip the structural matrix relies on)', async () => {
    const { result } = await run(
      JSON.stringify({
        items: [{ ...VALID_ITEM, recommendations: [{ ...VALID_RECOMMENDATION, smuggled: 'x' }] }],
      }),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.items[0]?.recommendations[0]).not.toHaveProperty('smuggled');
    }
  });

  it('a schema failure retries exactly once (two wire calls, attempt 2 final)', async () => {
    const provider = createMockProvider([
      { text: 'not json' },
      { text: JSON.stringify({ items: [VALID_ITEM] }) },
    ]);
    const { records, recordCall } = makeSink();
    const result = await runPrompt(
      improvementPlanV2,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('ok');
    expect(records.map((record) => record.status)).toEqual(['schema_failed', 'ok']);
    expect(records[1]?.attempt).toBe(2);
  });
});
