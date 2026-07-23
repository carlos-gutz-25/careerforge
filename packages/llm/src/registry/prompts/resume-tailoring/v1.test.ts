import { describe, expect, it } from 'vitest';

import { createMockProvider } from '../../../provider/mock.ts';
import { runPrompt, type LlmCallRecord } from '../../../run.ts';
import { resumeTailoringV1 } from './v1.ts';

// All fixture data is fictional (RISKS P-01).

const VALID_EMPHASIS = {
  entityRef: 's1',
  gapRefs: ['g1'],
  emphasis: 'lead',
  reason: 'Emphasized in light of the TypeScript requirement.',
};

const VALID_OUTPUT = {
  skillOrder: ['s1', 's2'],
  projectOrder: ['p1'],
  emphases: [VALID_EMPHASIS],
};

function makeSink() {
  const records: LlmCallRecord[] = [];
  return { records, recordCall: (record: LlmCallRecord) => void records.push(record) };
}

async function run(output: unknown) {
  const provider = createMockProvider([{ text: JSON.stringify(output) }]);
  const { records, recordCall } = makeSink();
  const result = await runPrompt(
    resumeTailoringV1,
    { untrustedData: '{"skills":[],"experiences":[],"projects":[],"gaps":[]}' },
    { provider, recordCall },
  );
  return { result, records };
}

describe('resume-tailoring@v1 module shape', () => {
  it('registers as resume-tailoring@v1 with thinking disabled and the 4096 budget', () => {
    expect(resumeTailoringV1.id).toBe('resume-tailoring@v1');
    expect(resumeTailoringV1.thinking).toBe('disabled');
    expect(resumeTailoringV1.maxTokens).toBe(4096);
  });

  it('is frozen — the deep-freeze law holds down into jsonSchema', () => {
    expect(Object.isFrozen(resumeTailoringV1)).toBe(true);
    expect(Object.isFrozen(resumeTailoringV1.jsonSchema)).toBe(true);
    expect(
      Object.isFrozen((resumeTailoringV1.jsonSchema as { properties: unknown }).properties),
    ).toBe(true);
  });

  it('jsonSchema twin: additionalProperties false, emphasis enum matches the core set', () => {
    const schema = resumeTailoringV1.jsonSchema as {
      additionalProperties: boolean;
      properties: {
        emphases: {
          items: { additionalProperties: boolean; properties: { emphasis: { enum: string[] } } };
        };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.emphases.items.additionalProperties).toBe(false);
    expect(schema.properties.emphases.items.properties.emphasis.enum).toEqual([
      'lead',
      'highlight',
    ]);
  });

  it('the system prompt bars prose and fact-framed reasons (ADR-0012 / N3)', () => {
    // Structural: the model is told it emits ordering/emphasis, not resume
    // text; the reason is judgment-framed, never a satisfies-claim.
    expect(resumeTailoringV1.system).toContain('You do NOT write resume text');
    expect(resumeTailoringV1.instructions).toContain('phrased as JUDGMENT');
    expect(resumeTailoringV1.instructions).toContain('Never claim the entry "satisfies"');
  });
});

describe('resume-tailoring@v1 output validation (caps live in zod)', () => {
  it('parses a valid spec', async () => {
    const { result } = await run(VALID_OUTPUT);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.skillOrder).toEqual(['s1', 's2']);
      expect(result.output.emphases[0]?.entityRef).toBe('s1');
    }
  });

  it('accepts an empty emphases list (pure reordering is honest)', async () => {
    const { result } = await run({ skillOrder: ['s1'], projectOrder: [], emphases: [] });
    expect(result.status).toBe('ok');
  });

  it('lowercases emphasis casing strays instead of paying a retry', async () => {
    const { result } = await run({
      ...VALID_OUTPUT,
      emphases: [{ ...VALID_EMPHASIS, emphasis: 'LEAD' }],
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.emphases[0]?.emphasis).toBe('lead');
    }
  });

  it('rejects malformed refs, dup orders, dup entityRef, bad gapRefs, over-cap reason, U+0000', async () => {
    const bad = [
      { ...VALID_OUTPUT, skillOrder: ['skill-1'] }, // malformed skill ref
      { ...VALID_OUTPUT, projectOrder: ['g1'] }, // wrong-prefix ref
      { ...VALID_OUTPUT, skillOrder: ['s1', 's1'] }, // duplicate order ref
      { ...VALID_OUTPUT, emphases: [VALID_EMPHASIS, { ...VALID_EMPHASIS }] }, // dup entityRef
      { ...VALID_OUTPUT, emphases: [{ ...VALID_EMPHASIS, gapRefs: [] }] }, // gapRefs min 1
      {
        ...VALID_OUTPUT,
        emphases: [{ ...VALID_EMPHASIS, gapRefs: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'] }],
      }, // gapRefs max 5
      { ...VALID_OUTPUT, emphases: [{ ...VALID_EMPHASIS, gapRefs: ['g1', 'g1'] }] }, // gapRefs dup
      { ...VALID_OUTPUT, emphases: [{ ...VALID_EMPHASIS, entityRef: 'x1' }] }, // bad entity prefix
      { ...VALID_OUTPUT, emphases: [{ ...VALID_EMPHASIS, reason: 'x'.repeat(301) }] }, // over cap
      { ...VALID_OUTPUT, emphases: [{ ...VALID_EMPHASIS, reason: 'a\u0000b' }] }, // U+0000
      { ...VALID_OUTPUT, emphases: Array.from({ length: 21 }, () => VALID_EMPHASIS) }, // over 20
    ];
    for (const output of bad) {
      const provider = createMockProvider([
        { text: JSON.stringify(output) },
        { text: JSON.stringify(output) },
      ]);
      const { recordCall } = makeSink();
      const result = await runPrompt(
        resumeTailoringV1,
        { untrustedData: '{}' },
        { provider, recordCall },
      );
      expect(result.status, JSON.stringify(output)).toBe('schema_failed');
    }
  });

  it('a schema failure retries exactly once (two wire calls, attempt 2 final)', async () => {
    const provider = createMockProvider([
      { text: 'not json' },
      { text: JSON.stringify(VALID_OUTPUT) },
    ]);
    const { records, recordCall } = makeSink();
    const result = await runPrompt(
      resumeTailoringV1,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('ok');
    expect(records.map((record) => record.status)).toEqual(['schema_failed', 'ok']);
    expect(records[1]?.attempt).toBe(2);
  });
});
