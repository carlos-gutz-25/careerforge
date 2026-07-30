import { describe, expect, it } from 'vitest';

import { profileFactImportSchema, profileFactSchema } from './profile.ts';

// M12-03: the durable-profile-fact schemas. Closed-vocabulary VALUE validation
// is per-kind (superRefine); the free-form kinds accept any non-empty string.
// All fictional (RISKS P-01), ASCII-only.

const baseWire = {
  id: 'aaaa0001-0000-4000-8000-000000000001',
  declaredAt: '2026-01-15',
  updatedAt: '2026-01-15T00:00:00.000Z',
  note: null,
};

describe('profileFactSchema (wire)', () => {
  it('accepts a valid free-form work_authorization fact', () => {
    const parsed = profileFactSchema.safeParse({
      ...baseWire,
      kind: 'work_authorization',
      value: 'Authorized to work in the US',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    const parsed = profileFactSchema.safeParse({
      ...baseWire,
      kind: 'favorite_color',
      value: 'blue',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an out-of-vocabulary relocation stance (per-kind refine)', () => {
    const parsed = profileFactSchema.safeParse({
      ...baseWire,
      kind: 'relocation_stance',
      value: 'maybe',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.includes('value'))).toBe(true);
    }
  });

  it('accepts an in-vocabulary relocation stance', () => {
    expect(
      profileFactSchema.safeParse({
        ...baseWire,
        kind: 'relocation_stance',
        value: 'open_for_right_opportunity',
      }).success,
    ).toBe(true);
  });

  it('constrains visa_sponsorship_needed to yes/no', () => {
    expect(
      profileFactSchema.safeParse({ ...baseWire, kind: 'visa_sponsorship_needed', value: 'no' })
        .success,
    ).toBe(true);
    expect(
      profileFactSchema.safeParse({ ...baseWire, kind: 'visa_sponsorship_needed', value: 'maybe' })
        .success,
    ).toBe(false);
  });

  it('rejects an empty value and a U+0000 in a value', () => {
    expect(
      profileFactSchema.safeParse({ ...baseWire, kind: 'work_authorization', value: '' }).success,
    ).toBe(false);
    expect(
      profileFactSchema.safeParse({
        ...baseWire,
        kind: 'work_authorization',
        value: `bad${String.fromCharCode(0)}value`,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-strict extra key', () => {
    expect(
      profileFactSchema.safeParse({
        ...baseWire,
        kind: 'work_authorization',
        value: 'US',
        extra: 'nope',
      }).success,
    ).toBe(false);
  });
});

describe('profileFactImportSchema (facts.md import shape)', () => {
  it('accepts the pre-DB shape (no id/updatedAt) and applies the same value vocab', () => {
    expect(
      profileFactImportSchema.safeParse({
        kind: 'remote_onsite_stance',
        value: 'prefer_remote',
        note: null,
        declaredAt: '2026-01-15',
      }).success,
    ).toBe(true);
    expect(
      profileFactImportSchema.safeParse({
        kind: 'remote_onsite_stance',
        value: 'sometimes',
        note: null,
        declaredAt: '2026-01-15',
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed declared date', () => {
    expect(
      profileFactImportSchema.safeParse({
        kind: 'availability_notice',
        value: 'Two weeks',
        note: null,
        declaredAt: 'January 2026',
      }).success,
    ).toBe(false);
  });
});
