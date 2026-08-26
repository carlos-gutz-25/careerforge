import { describe, expect, it } from 'vitest';

import { extractRequirementsV1 } from './v1.ts';

const requirement = {
  kind: 'must_have',
  category: 'language',
  text: 'Strong TypeScript experience',
  sourceQuote: '5+ years building production TypeScript services',
  confidence: 0.95,
};

const parse = (requirements: unknown[]) =>
  extractRequirementsV1.outputSchema.safeParse({ requirements });

describe('extract-requirements@v1', () => {
  it('is pinned to thinking disabled with the whole budget serving the response (M1-05 decision 1)', () => {
    expect(extractRequirementsV1.thinking).toBe('disabled');
    expect(extractRequirementsV1.maxTokens).toBe(8192);
    expect(extractRequirementsV1.id).toBe('extract-requirements@v1');
  });

  it('parses a representative valid output', () => {
    const result = parse([requirement]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirements[0]).toEqual(requirement);
    }
  });

  it('truncates overflow past 50 instead of failing the run - the tail is the droppable part by the most-significant-first ordering (observed live 2026-08-26: 60 valid requirements hard-failed two paid runs)', () => {
    const result = parse(Array.from({ length: 60 }, () => ({ ...requirement })));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirements).toHaveLength(50);
    }
  });

  it('does not let a malformed entry past position 50 fail the 50 kept - the slice runs before element validation', () => {
    const overflow = [
      ...Array.from({ length: 55 }, () => ({ ...requirement })),
      { ...requirement, confidence: 7 },
    ];
    const result = parse(overflow);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirements).toHaveLength(50);
    }
  });

  it('keeps caps zod-side: over-cap strings fail zod while the wire twin is cap-free', () => {
    expect(parse([{ ...requirement, text: 'x'.repeat(501) }]).success).toBe(false);
    expect(parse([{ ...requirement, sourceQuote: 'q'.repeat(1001) }]).success).toBe(false);
    // The ARRAY cap is no longer a failure: overflow truncates to 50 (see the
    // truncation tests above). The per-entry caps stay hard failures.
    expect(parse([{ ...requirement, confidence: 1.5 }]).success).toBe(false);
    // The wire twin carries no length/count/bound constraints — the
    // structured-outputs subset cannot express them (ADR-0005 amendment).
    expect(JSON.stringify(extractRequirementsV1.jsonSchema)).not.toMatch(
      /maxLength|minLength|maxItems|minimum|maximum/,
    );
  });

  it('rejects U+0000 in requirement strings — model-emitted NULs take the schema_failed path, not a failed insert (external review P2)', () => {
    expect(parse([{ ...requirement, sourceQuote: 'quote with \u0000 inside' }]).success).toBe(
      false,
    );
    expect(parse([{ ...requirement, text: '\u0000' }]).success).toBe(false);
  });

  it('lowercases enum values before matching — wire enum casing is not guaranteed (external review P3)', () => {
    const result = parse([{ ...requirement, kind: 'MUST_HAVE', category: 'Language' }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirements[0]?.kind).toBe('must_have');
      expect(result.data.requirements[0]?.category).toBe('language');
    }
    expect(parse([{ ...requirement, kind: 'REQUIRED' }]).success).toBe(false);
  });

  it('carries enum constraints on the wire twin so the model is schema-constrained to the value sets', () => {
    const twin = JSON.stringify(extractRequirementsV1.jsonSchema);
    expect(twin).toContain('"must_have"');
    expect(twin).toContain('"nice_to_have"');
    expect(twin).toContain('"seniority"');
    expect(twin).toContain('"additionalProperties":false');
  });
});
