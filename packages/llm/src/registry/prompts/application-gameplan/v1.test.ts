import { GAMEPLAN_PHASES } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import {
  GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP,
  GAMEPLAN_STORY_CITATIONS_MAX,
} from '../../../drafting/gameplan-payload.ts';
import { createMockProvider } from '../../../provider/mock.ts';
import { runPrompt, type LlmCallRecord } from '../../../run.ts';
import { applicationGameplanV1 } from './v1.ts';

// All fixture data is fictional (RISKS P-01). Caps live in zod (ADR-0006 layer 3);
// the wire jsonSchema twin carries types + required + additionalProperties:false
// ONLY. The phaseStrategies-object shape makes exactly-one-per-phase structural at
// the wire layer (D1) and is pinned to GAMEPLAN_PHASES here so a phase-vocabulary
// change goes RED.

const VALID_STORY = {
  requirementRef: 'r1',
  situation: 'Owned a fictional payments migration under a tight deadline.',
  task: 'Cut over the ledger without downtime.',
  action: 'Shipped a dual-write path and backfilled in batches.',
  result: 'Zero-downtime cutover; error budget untouched.',
  citationRefs: ['e1'],
};

const VALID_OUTPUT = {
  strategySummary:
    'Lead with the strongest TypeScript evidence and name the observability gap honestly.',
  phaseStrategies: {
    apply: 'Tailor the resume to the must-have TypeScript and PostgreSQL work.',
    screen: 'Prepare a crisp two-minute intro grounded in the platform story.',
    interview: 'Rehearse the STAR stories out loud; lead with the migration.',
    offer: 'Research the compensation band before any negotiation.',
  },
  stories: [VALID_STORY],
};

function makeSink() {
  const records: LlmCallRecord[] = [];
  return { records, recordCall: (record: LlmCallRecord) => void records.push(record) };
}

const parse = (output: unknown) => applicationGameplanV1.outputSchema.safeParse(output);

describe('application-gameplan@v1 module shape', () => {
  it('registers as application-gameplan@v1 with thinking disabled and the 8192 budget', () => {
    expect(applicationGameplanV1.id).toBe('application-gameplan@v1');
    expect(applicationGameplanV1.thinking).toBe('disabled');
    expect(applicationGameplanV1.maxTokens).toBe(8192);
  });

  it('is frozen - the deep-freeze law holds down into nested jsonSchema nodes', () => {
    expect(Object.isFrozen(applicationGameplanV1)).toBe(true);
    expect(Object.isFrozen(applicationGameplanV1.jsonSchema)).toBe(true);
    const props = (applicationGameplanV1.jsonSchema as { properties: Record<string, unknown> })
      .properties;
    expect(Object.isFrozen(props)).toBe(true);
    expect(Object.isFrozen(props.phaseStrategies)).toBe(true);
    expect(Object.isFrozen((props.stories as { items: unknown }).items)).toBe(true);
  });

  it('the two caps are one number by construction (the D5 identity pin)', () => {
    expect(GAMEPLAN_STORY_CITATIONS_MAX).toBe(GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP);
  });
});

describe('application-gameplan@v1 jsonSchema twin', () => {
  const schema = applicationGameplanV1.jsonSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: {
      phaseStrategies: {
        additionalProperties: boolean;
        required: string[];
        properties: Record<string, unknown>;
      };
      stories: {
        items: { additionalProperties: boolean; required: string[] };
      };
    };
  };

  it('additionalProperties:false at root, phaseStrategies, and story levels', () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.phaseStrategies.additionalProperties).toBe(false);
    expect(schema.properties.stories.items.additionalProperties).toBe(false);
  });

  it('phaseStrategies required AND property keys both equal GAMEPLAN_PHASES (the D1 derivation pin)', () => {
    expect(schema.properties.phaseStrategies.required).toEqual([...GAMEPLAN_PHASES]);
    expect(Object.keys(schema.properties.phaseStrategies.properties)).toEqual([...GAMEPLAN_PHASES]);
  });

  it('the zod phaseStrategies shape keys also equal GAMEPLAN_PHASES (RED if the vocabulary drifts)', () => {
    const zodShape = (
      applicationGameplanV1.outputSchema as unknown as {
        shape: { phaseStrategies: { shape: Record<string, unknown> } };
      }
    ).shape.phaseStrategies.shape;
    expect(Object.keys(zodShape)).toEqual([...GAMEPLAN_PHASES]);
  });

  it('story required lists all six fields; root required lists all three', () => {
    expect(schema.properties.stories.items.required).toEqual([
      'requirementRef',
      'situation',
      'task',
      'action',
      'result',
      'citationRefs',
    ]);
    expect(schema.required).toEqual(['strategySummary', 'phaseStrategies', 'stories']);
  });

  it('the twin carries NO length/count/pattern constraints (they live in zod)', () => {
    const serialized = JSON.stringify(applicationGameplanV1.jsonSchema);
    for (const banned of ['minLength', 'maxLength', 'maxItems', 'minItems', 'pattern']) {
      expect(serialized, banned).not.toContain(banned);
    }
  });
});

describe('application-gameplan@v1 output validation (caps live in zod)', () => {
  it('parses a full valid output (summary + 4 phases + 2 stories with 1 and 3 citations)', () => {
    const output = {
      ...VALID_OUTPUT,
      stories: [
        VALID_STORY,
        { ...VALID_STORY, requirementRef: 'r2', citationRefs: ['e1', 'e2', 'e3'] },
      ],
    };
    expect(parse(output).success).toBe(true);
  });

  it('parses an output with zero stories (the zero-stories law)', () => {
    expect(parse({ ...VALID_OUTPUT, stories: [] }).success).toBe(true);
  });

  it('parses boundary lengths (600-char summary, 600-char phase, 300-char STAR field)', () => {
    const output = {
      strategySummary: 'x'.repeat(600),
      phaseStrategies: {
        apply: 'a'.repeat(600),
        screen: 'shorter',
        interview: 'shorter',
        offer: 'shorter',
      },
      stories: [{ ...VALID_STORY, situation: 's'.repeat(300) }],
    };
    expect(parse(output).success).toBe(true);
  });

  it('rejects malformed shape, over-cap lengths, U+0000, bad refs, cardinality, and unknown keys', () => {
    const longSummary = 'x'.repeat(601);
    const longPhase = 'x'.repeat(601);
    const longStar = 'x'.repeat(301);
    const nul = 'a\u0000b';
    const bad: unknown[] = [
      // phaseStrategies: missing a required key, and an extra fifth key.
      { ...VALID_OUTPUT, phaseStrategies: { apply: 'a', screen: 'b', interview: 'c' } },
      {
        ...VALID_OUTPUT,
        phaseStrategies: { ...VALID_OUTPUT.phaseStrategies, extra: 'nope' },
      },
      // stories cardinality: over the max of 6.
      { ...VALID_OUTPUT, stories: Array.from({ length: 7 }, () => VALID_STORY) },
      // citation cardinality: 0 and 4 are both malformed shape.
      { ...VALID_OUTPUT, stories: [{ ...VALID_STORY, citationRefs: [] }] },
      { ...VALID_OUTPUT, stories: [{ ...VALID_STORY, citationRefs: ['e1', 'e2', 'e3', 'e4'] }] },
      // over-cap lengths.
      { ...VALID_OUTPUT, strategySummary: longSummary },
      { ...VALID_OUTPUT, phaseStrategies: { ...VALID_OUTPUT.phaseStrategies, apply: longPhase } },
      { ...VALID_OUTPUT, stories: [{ ...VALID_STORY, action: longStar }] },
      // empty STAR field (min 1).
      { ...VALID_OUTPUT, stories: [{ ...VALID_STORY, task: '' }] },
      // bad ref shapes.
      { ...VALID_OUTPUT, stories: [{ ...VALID_STORY, requirementRef: 'x1' }] },
      { ...VALID_OUTPUT, stories: [{ ...VALID_STORY, citationRefs: ['g1'] }] },
      // U+0000 in each drafted-prose surface.
      { ...VALID_OUTPUT, strategySummary: nul },
      { ...VALID_OUTPUT, phaseStrategies: { ...VALID_OUTPUT.phaseStrategies, offer: nul } },
      { ...VALID_OUTPUT, stories: [{ ...VALID_STORY, result: nul }] },
      // unknown extra field on a story.
      { ...VALID_OUTPUT, stories: [{ ...VALID_STORY, extra: 'nope' }] },
      // missing top-level key.
      {
        strategySummary: VALID_OUTPUT.strategySummary,
        phaseStrategies: VALID_OUTPUT.phaseStrategies,
      },
    ];
    for (const output of bad) {
      expect(parse(output).success, JSON.stringify(output).slice(0, 90)).toBe(false);
    }
  });
});

describe('application-gameplan@v1 runPrompt round-trip (mocked provider)', () => {
  it('schema-valid text yields ok with the parsed output', async () => {
    const provider = createMockProvider([{ text: JSON.stringify(VALID_OUTPUT) }]);
    const { recordCall } = makeSink();
    const result = await runPrompt(
      applicationGameplanV1,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.output).toEqual(VALID_OUTPUT);
    }
  });

  it('invalid then valid retries exactly once (schema_failed then ok, attempt 2 final)', async () => {
    const provider = createMockProvider([
      { text: 'not json' },
      { text: JSON.stringify(VALID_OUTPUT) },
    ]);
    const { records, recordCall } = makeSink();
    const result = await runPrompt(
      applicationGameplanV1,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('ok');
    expect(records.map((record) => record.status)).toEqual(['schema_failed', 'ok']);
    expect(records[1]?.attempt).toBe(2);
  });

  it('a persistently invalid output ends schema_failed after the single retry', async () => {
    const provider = createMockProvider([{ text: '{"bad":true}' }, { text: '{"bad":true}' }]);
    const { recordCall } = makeSink();
    const result = await runPrompt(
      applicationGameplanV1,
      { untrustedData: '{}' },
      { provider, recordCall },
    );
    expect(result.status).toBe('schema_failed');
  });
});
