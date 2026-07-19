import { describe, expect, it } from 'vitest';

import { createMockProvider } from '../../../provider/mock.ts';
import { runPrompt, type LlmCallRecord } from '../../../run.ts';
import { improvementPlanV1 } from './v1.ts';

// All fixture data is fictional (RISKS P-01).

const VALID_ITEM = {
  gapRef: 'g1',
  action: 'Publish a fictional k8s lab writeup.',
  priority: 'high',
};

function makeSink() {
  const records: LlmCallRecord[] = [];
  return { records, recordCall: (record: LlmCallRecord) => void records.push(record) };
}

async function run(text: string) {
  const provider = createMockProvider([{ text }]);
  const { records, recordCall } = makeSink();
  const result = await runPrompt(
    improvementPlanV1,
    { untrustedData: '{"profileSkills":[],"gaps":[]}' },
    { provider, recordCall },
  );
  return { result, records, provider };
}

describe('improvement-plan@v1 module shape', () => {
  it('registers as improvement-plan@v1 with thinking disabled and the 4096 budget', () => {
    expect(improvementPlanV1.id).toBe('improvement-plan@v1');
    expect(improvementPlanV1.thinking).toBe('disabled');
    expect(improvementPlanV1.maxTokens).toBe(4096);
  });

  it('is frozen — the deep-freeze law holds down into jsonSchema', () => {
    expect(Object.isFrozen(improvementPlanV1)).toBe(true);
    expect(Object.isFrozen(improvementPlanV1.jsonSchema)).toBe(true);
    expect(
      Object.isFrozen((improvementPlanV1.jsonSchema as { properties: unknown }).properties),
    ).toBe(true);
  });

  it('jsonSchema twin: additionalProperties false at both levels, enums match the core set', () => {
    const schema = improvementPlanV1.jsonSchema as {
      additionalProperties: boolean;
      properties: {
        items: {
          items: { additionalProperties: boolean; properties: { priority: { enum: string[] } } };
        };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.items.items.additionalProperties).toBe(false);
    expect(schema.properties.items.items.properties.priority.enum).toEqual([
      'high',
      'medium',
      'low',
    ]);
  });
});

describe('improvement-plan@v1 output validation (caps live in zod)', () => {
  it('parses a valid item list', async () => {
    const { result } = await run(JSON.stringify({ items: [VALID_ITEM] }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.items).toEqual([VALID_ITEM]);
    }
  });

  it('lowercases priority casing strays instead of paying a retry', async () => {
    const { result } = await run(JSON.stringify({ items: [{ ...VALID_ITEM, priority: 'HIGH' }] }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.items[0]?.priority).toBe('high');
    }
  });

  it('rejects a malformed ref, an over-cap action, U+0000, and an empty/oversized list', async () => {
    const bad = [
      { items: [{ ...VALID_ITEM, gapRef: 'gap-1' }] },
      { items: [{ ...VALID_ITEM, action: 'x'.repeat(401) }] },
      { items: [{ ...VALID_ITEM, action: 'a\u0000b' }] },
      { items: [] },
      { items: Array.from({ length: 21 }, () => VALID_ITEM) },
    ];
    for (const output of bad) {
      const provider = createMockProvider([
        { text: JSON.stringify(output) },
        { text: JSON.stringify(output) },
      ]);
      const { recordCall } = makeSink();
      const result = await runPrompt(
        improvementPlanV1,
        { untrustedData: '{}' },
        { provider, recordCall },
      );
      expect(result.status).toBe('schema_failed');
    }
  });

  it('a schema failure retries exactly once (two wire calls, attempt 2 final)', async () => {
    const provider = createMockProvider([
      { text: 'not json' },
      { text: JSON.stringify({ items: [VALID_ITEM] }) },
    ]);
    const { records, recordCall } = makeSink();
    const result = await runPrompt(
      improvementPlanV1,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('ok');
    expect(records.map((record) => record.status)).toEqual(['schema_failed', 'ok']);
    expect(records[1]?.attempt).toBe(2);
  });
});
