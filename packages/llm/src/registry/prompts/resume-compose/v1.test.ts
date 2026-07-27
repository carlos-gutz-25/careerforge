import { RESUME_CLAIM_SECTIONS } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import { createMockProvider } from '../../../provider/mock.ts';
import { runPrompt, type LlmCallRecord } from '../../../run.ts';
import { resumeComposeV1 } from './v1.ts';

// All fixture data is fictional (RISKS P-01).

const EXPERIENCE_CLAIM = {
  text: 'Led a fictional platform migration for the payments team.',
  section: 'experience' as const,
  entityRef: 'x1',
  citationRefs: ['ev1'],
};

const SUMMARY_CLAIM = {
  text: 'A fictional staff engineer with a decade of platform work.',
  section: 'summary' as const,
  entityRef: null,
  citationRefs: ['ev1', 'ev2', 'ev3', 'ev4'],
};

const parse = (output: unknown) => resumeComposeV1.outputSchema.safeParse(output);

function makeSink() {
  const records: LlmCallRecord[] = [];
  return { records, recordCall: (record: LlmCallRecord) => void records.push(record) };
}

describe('resume-compose@v1 module shape', () => {
  it('registers as resume-compose@v1 with thinking disabled and the 8192 budget', () => {
    expect(resumeComposeV1.id).toBe('resume-compose@v1');
    expect(resumeComposeV1.thinking).toBe('disabled');
    expect(resumeComposeV1.maxTokens).toBe(8192);
  });

  it('is frozen - the deep-freeze law holds down into jsonSchema', () => {
    expect(Object.isFrozen(resumeComposeV1)).toBe(true);
    expect(Object.isFrozen(resumeComposeV1.jsonSchema)).toBe(true);
    expect(
      Object.isFrozen((resumeComposeV1.jsonSchema as { properties: unknown }).properties),
    ).toBe(true);
  });

  it('jsonSchema twin: additionalProperties false at both levels, section enum matches core, NO cap keys', () => {
    const schema = resumeComposeV1.jsonSchema as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        claims: {
          items: {
            additionalProperties: boolean;
            required: string[];
            properties: {
              section: { enum: string[] };
              entityRef: { type: string[] };
            };
          };
        };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['claims']);
    const item = schema.properties.claims.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['text', 'section', 'entityRef', 'citationRefs']);
    expect(item.properties.section.enum).toEqual([...RESUME_CLAIM_SECTIONS]);
    expect(item.properties.entityRef.type).toEqual(['string', 'null']);
    // The wire subset carries NO length/cardinality caps (plan D1): those are gate laws.
    const wire = JSON.stringify(resumeComposeV1.jsonSchema);
    expect(wire).not.toContain('maxItems');
    expect(wire).not.toContain('minItems');
    expect(wire).not.toContain('maxLength');
    expect(wire).not.toContain('pattern');
  });

  it('the system prompt bars fabrication, number-expansion, and external pointers (ADR-0018/0017)', () => {
    expect(resumeComposeV1.system).toContain('Compose ONLY from');
    expect(resumeComposeV1.system).toContain('digit-for-digit');
    expect(resumeComposeV1.instructions).toContain(
      'never repeat a reference code within one claim',
    );
    expect(resumeComposeV1.instructions).toContain('NEVER cite a personal project');
  });
});

describe('resume-compose@v1 output schema (element shape only; caps are gate laws)', () => {
  it('parses a valid experience claim (non-null entityRef, one citation)', () => {
    expect(parse({ claims: [EXPERIENCE_CLAIM] }).success).toBe(true);
  });

  it('parses a valid summary claim (null entityRef, four citations)', () => {
    expect(parse({ claims: [SUMMARY_CLAIM] }).success).toBe(true);
  });

  it('parses an empty claims array (empty-draft policy is M6-04, not a schema error)', () => {
    expect(parse({ claims: [] }).success).toBe(true);
  });

  it('rejects 0 citations, 5 citations, U+0000 in text, an unknown field, and a missing citationRefs key', () => {
    expect(parse({ claims: [{ ...EXPERIENCE_CLAIM, citationRefs: [] }] }).success).toBe(false);
    expect(
      parse({
        claims: [{ ...EXPERIENCE_CLAIM, citationRefs: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'] }],
      }).success,
    ).toBe(false);
    expect(parse({ claims: [{ ...EXPERIENCE_CLAIM, text: 'a\u0000b' }] }).success).toBe(false);
    expect(parse({ claims: [{ ...EXPERIENCE_CLAIM, extra: 1 }] }).success).toBe(false);
    expect(
      parse({ claims: [{ text: 'no citations key', section: 'summary', entityRef: null }] })
        .success,
    ).toBe(false);
  });

  it('an over-300-char text, a 41st claim, and an entityRef on a summary claim ALL PARSE (gate laws, not schema errors - D1)', () => {
    // The single-verdict-site decision, pinned as a test: these are L6 gate
    // flags at M6-04, never schema_failed/400 at the boundary.
    expect(parse({ claims: [{ ...EXPERIENCE_CLAIM, text: 'x'.repeat(350) }] }).success).toBe(true);
    const fortyOne = Array.from({ length: 41 }, () => EXPERIENCE_CLAIM);
    expect(parse({ claims: fortyOne }).success).toBe(true);
    expect(parse({ claims: [{ ...SUMMARY_CLAIM, entityRef: 'x1' }] }).success).toBe(true);
  });
});

describe('resume-compose@v1 runPrompt round-trip (mock provider)', () => {
  it('a schema-valid response yields ok with parsed claims', async () => {
    const provider = createMockProvider([
      { text: JSON.stringify({ claims: [EXPERIENCE_CLAIM, SUMMARY_CLAIM] }) },
    ]);
    const { recordCall } = makeSink();
    const result = await runPrompt(
      resumeComposeV1,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.claims).toHaveLength(2);
      expect(result.output.claims[0]?.section).toBe('experience');
    }
  });

  it('an invalid response retries exactly once then schema_failed (two wire calls)', async () => {
    const bad = JSON.stringify({ claims: [{ ...EXPERIENCE_CLAIM, citationRefs: [] }] });
    const provider = createMockProvider([{ text: bad }, { text: bad }]);
    const { records, recordCall } = makeSink();
    const result = await runPrompt(
      resumeComposeV1,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('schema_failed');
    expect(records.map((record) => record.status)).toEqual(['schema_failed', 'schema_failed']);
    expect(records[1]?.attempt).toBe(2);
  });
});
