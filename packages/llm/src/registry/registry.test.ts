import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { promptContentHash } from './hash.ts';
import { getPrompt, promptRegistry } from './index.ts';
import { PROMPT_PINS } from './pins.ts';
import { definePrompt } from './types.ts';

const VALID_INPUT = {
  name: 'test-prompt',
  version: 1,
  system: 'static system',
  instructions: 'static instructions',
  outputSchema: z.object({ ok: z.boolean() }),
  jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  maxTokens: 1024,
};

describe('definePrompt', () => {
  it('computes the stable versioned id', () => {
    expect(definePrompt(VALID_INPUT).id).toBe('test-prompt@v1');
  });

  it('rejects non-kebab-case names', () => {
    expect(() => definePrompt({ ...VALID_INPUT, name: 'Bad_Name' })).toThrowError(/kebab-case/);
  });

  it('rejects non-positive and non-integer versions', () => {
    expect(() => definePrompt({ ...VALID_INPUT, version: 0 })).toThrowError(/version/);
    expect(() => definePrompt({ ...VALID_INPUT, version: 1.5 })).toThrowError(/version/);
  });

  it('rejects a non-positive maxTokens', () => {
    expect(() => definePrompt({ ...VALID_INPUT, maxTokens: 0 })).toThrowError(/maxTokens/);
  });

  it('freezes the definition and its wire schema — edit-in-place throws', () => {
    const prompt = definePrompt(VALID_INPUT);
    expect(Object.isFrozen(prompt)).toBe(true);
    expect(Object.isFrozen(prompt.jsonSchema)).toBe(true);
    expect(() => {
      (prompt as { system: string }).system = 'mutated';
    }).toThrowError();
  });

  it('freezes NESTED wire-schema nodes — a runtime mutation deep in jsonSchema throws (external review F2)', () => {
    const prompt = definePrompt({
      ...VALID_INPUT,
      jsonSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string', enum: ['a', 'b'] },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    });
    const properties = prompt.jsonSchema['properties'] as {
      items: { items: { enum: string[] } };
    };
    expect(Object.isFrozen(properties)).toBe(true);
    expect(Object.isFrozen(properties.items)).toBe(true);
    expect(Object.isFrozen(properties.items.items)).toBe(true);
    expect(Object.isFrozen(properties.items.items.enum)).toBe(true);
    expect(() => {
      properties.items.items.enum.push('smuggled');
    }).toThrowError();
  });
});

describe('prompt registry', () => {
  it('registers at least the fixture prompt, keyed by id', () => {
    expect(promptRegistry.size).toBeGreaterThanOrEqual(1);
    for (const [id, prompt] of promptRegistry) {
      expect(id).toBe(prompt.id);
    }
  });

  it('resolves a known id and throws on an unknown one', () => {
    expect(getPrompt('fixture-echo@v1').name).toBe('fixture-echo');
    expect(() => getPrompt('nope@v9')).toThrowError(/unknown prompt id/);
  });
});

describe('prompt pins (the edit-in-place tripwire)', () => {
  it('every registered version hashes to its pin — new prompt behavior = new version id, never edit-in-place', () => {
    for (const prompt of promptRegistry.values()) {
      const pinned = PROMPT_PINS[prompt.id];
      expect(pinned, `${prompt.id} has no pin in registry/pins.ts`).toBeDefined();
      expect(
        promptContentHash(prompt),
        `${prompt.id} content changed under a shipped id — new prompt behavior = new version file + new pin (CLAUDE.md versioning law), never an in-place edit`,
      ).toBe(pinned);
    }
  });

  it('every pin corresponds to a registered version (no orphaned pins)', () => {
    for (const id of Object.keys(PROMPT_PINS)) {
      expect(promptRegistry.has(id), `pin ${id} has no registered prompt`).toBe(true);
    }
  });
});
