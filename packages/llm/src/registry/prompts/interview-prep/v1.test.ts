import { describe, expect, it } from 'vitest';

import { createMockProvider } from '../../../provider/mock.ts';
import { runPrompt, type LlmCallRecord } from '../../../run.ts';
import { interviewPrepV1 } from './v1.ts';

// All fixture data is fictional (RISKS P-01).

const VALID_QUESTION = {
  requirementRef: 'r1',
  kind: 'technical',
  question: 'How have you structured a large TypeScript codebase?',
  evidencePoints: [
    {
      evidenceRef: 'e1',
      text: 'Speak from the fictional platform work the profile quote shows.',
    },
  ],
  gapDisclosures: [],
};

function makeSink() {
  const records: LlmCallRecord[] = [];
  return { records, recordCall: (record: LlmCallRecord) => void records.push(record) };
}

async function run(text: string) {
  const provider = createMockProvider([{ text }]);
  const { records, recordCall } = makeSink();
  const result = await runPrompt(
    interviewPrepV1,
    { untrustedData: '{"profileSkills":[],"requirements":[]}' },
    { provider, recordCall },
  );
  return { result, records, provider };
}

describe('interview-prep@v1 module shape', () => {
  it('registers as interview-prep@v1 with thinking disabled and the 12288 budget', () => {
    expect(interviewPrepV1.id).toBe('interview-prep@v1');
    expect(interviewPrepV1.thinking).toBe('disabled');
    expect(interviewPrepV1.maxTokens).toBe(12288);
  });

  it('is frozen — the deep-freeze law holds down into jsonSchema', () => {
    expect(Object.isFrozen(interviewPrepV1)).toBe(true);
    expect(Object.isFrozen(interviewPrepV1.jsonSchema)).toBe(true);
    expect(
      Object.isFrozen((interviewPrepV1.jsonSchema as { properties: unknown }).properties),
    ).toBe(true);
  });

  it('jsonSchema twin: additionalProperties false at every level, kind enum matches the core set', () => {
    const schema = interviewPrepV1.jsonSchema as {
      additionalProperties: boolean;
      properties: {
        questions: {
          items: {
            additionalProperties: boolean;
            required: string[];
            properties: {
              kind: { enum: string[] };
              evidencePoints: { items: { additionalProperties: boolean } };
            };
          };
        };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.questions.items.additionalProperties).toBe(false);
    expect(
      schema.properties.questions.items.properties.evidencePoints.items.additionalProperties,
    ).toBe(false);
    expect(schema.properties.questions.items.properties.kind.enum).toEqual([
      'technical',
      'behavioral',
    ]);
    // Every property is listed required — the wire subset carries no optional
    // fields (the two-array output-shape rationale in the module comment).
    expect(schema.properties.questions.items.required).toEqual([
      'requirementRef',
      'kind',
      'question',
      'evidencePoints',
      'gapDisclosures',
    ]);
  });
});

describe('interview-prep@v1 output validation (caps live in zod)', () => {
  it('parses a valid question list, including a disclosure-bearing question', async () => {
    const withDisclosure = {
      requirementRef: 'r2',
      kind: 'behavioral',
      question: 'Tell me about operating Kubernetes in production.',
      evidencePoints: [],
      gapDisclosures: [
        'Be upfront: no production Kubernetes operations yet; describe the learning plan instead.',
      ],
    };
    const { result } = await run(JSON.stringify({ questions: [VALID_QUESTION, withDisclosure] }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.questions).toEqual([VALID_QUESTION, withDisclosure]);
    }
  });

  it('lowercases kind casing strays instead of paying a retry', async () => {
    const { result } = await run(
      JSON.stringify({ questions: [{ ...VALID_QUESTION, kind: 'Technical' }] }),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output.questions[0]?.kind).toBe('technical');
    }
  });

  it('rejects malformed refs, over-cap text, U+0000, list bounds, and over-cap combined points', async () => {
    const longText = 'x'.repeat(401);
    const fourEvidence = Array.from({ length: 4 }, (_, i) => ({
      evidenceRef: 'e' + String(i + 1),
      text: 'point',
    }));
    const bad = [
      { questions: [{ ...VALID_QUESTION, requirementRef: 'req-1' }] },
      { questions: [{ ...VALID_QUESTION, kind: 'situational' }] },
      {
        questions: [
          { ...VALID_QUESTION, evidencePoints: [{ evidenceRef: 'link-1', text: 'point' }] },
        ],
      },
      { questions: [{ ...VALID_QUESTION, question: longText }] },
      {
        questions: [{ ...VALID_QUESTION, evidencePoints: [{ evidenceRef: 'e1', text: longText }] }],
      },
      { questions: [{ ...VALID_QUESTION, gapDisclosures: [longText] }] },
      { questions: [{ ...VALID_QUESTION, question: 'a\u0000b' }] },
      { questions: [] },
      { questions: Array.from({ length: 16 }, () => VALID_QUESTION) },
      // 4 evidence points + 1 disclosure = 5 > the combined cap of 4.
      {
        questions: [
          { ...VALID_QUESTION, evidencePoints: fourEvidence, gapDisclosures: ['honest gap note'] },
        ],
      },
    ];
    for (const output of bad) {
      const provider = createMockProvider([
        { text: JSON.stringify(output) },
        { text: JSON.stringify(output) },
      ]);
      const { recordCall } = makeSink();
      const result = await runPrompt(
        interviewPrepV1,
        { untrustedData: '{}' },
        { provider, recordCall },
      );
      expect(result.status, JSON.stringify(output).slice(0, 80)).toBe('schema_failed');
    }
  });

  it('a schema failure retries exactly once (two wire calls, attempt 2 final)', async () => {
    const provider = createMockProvider([
      { text: 'not json' },
      { text: JSON.stringify({ questions: [VALID_QUESTION] }) },
    ]);
    const { records, recordCall } = makeSink();
    const result = await runPrompt(
      interviewPrepV1,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('ok');
    expect(records.map((record) => record.status)).toEqual(['schema_failed', 'ok']);
    expect(records[1]?.attempt).toBe(2);
  });
});
