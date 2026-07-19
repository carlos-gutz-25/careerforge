import { type GapAssignment } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import {
  bindPriorOverrides,
  resolveGapRows,
  type CurrentGapKey,
  type PriorOverriddenGap,
} from './gap-carry.ts';

// Pure unit tests for the A1 binding core. All data fictional (RISKS P-01).

function prior(over: Partial<PriorOverriddenGap> = {}): PriorOverriddenGap {
  return {
    requirementId: 'p1111111-1111-4111-8111-111111111111',
    requirementText: 'Kubernetes cluster operations',
    classification: 'have_undemonstrated',
    overrideNote: 'fictional override note',
    ...over,
  };
}

function current(over: Partial<CurrentGapKey> = {}): CurrentGapKey {
  return {
    requirementId: 'c1111111-1111-4111-8111-111111111111',
    requirementText: 'Kubernetes cluster operations',
    ...over,
  };
}

describe('bindPriorOverrides', () => {
  it('binds by requirement_id first (the re-score case)', () => {
    const p = prior({ requirementId: 'same-id', requirementText: 'anything at all' });
    const c = current({ requirementId: 'same-id', requirementText: 'entirely different text' });
    const binding = bindPriorOverrides([c], [p]);
    expect(binding.bound.get('same-id')).toEqual({ prior: p, via: 'requirement_id' });
    expect(binding.lostOverrides).toBe(0);
  });

  it('binds by one-to-one normalized text when ids differ (the re-extraction case)', () => {
    const p = prior({ requirementText: 'Kubernetes   cluster \n operations' });
    const c = current({ requirementText: 'Kubernetes cluster operations' });
    const binding = bindPriorOverrides([c], [p]);
    expect(binding.bound.get(c.requirementId)).toEqual({ prior: p, via: 'content' });
    expect(binding.lostOverrides).toBe(0);
  });

  it('t2: duplicate normalized text among CURRENT rows => no carry, override lost', () => {
    const p = prior();
    const c1 = current({ requirementId: 'c-1' });
    const c2 = current({ requirementId: 'c-2' });
    const binding = bindPriorOverrides([c1, c2], [p]);
    expect(binding.bound.size).toBe(0);
    expect(binding.lostOverrides).toBe(1);
  });

  it('t3: two distinct PRIOR overridden rows sharing normalized text => no carry, both lost', () => {
    const p1 = prior({ requirementId: 'p-1' });
    const p2 = prior({ requirementId: 'p-2', classification: 'have' });
    const c = current();
    const binding = bindPriorOverrides([c], [p1, p2]);
    expect(binding.bound.size).toBe(0);
    expect(binding.lostOverrides).toBe(2);
  });

  it('a prior row consumed by requirement_id is never re-bound by content', () => {
    const p = prior({ requirementId: 'same-id' });
    const byId = current({ requirementId: 'same-id', requirementText: 'different text' });
    const byText = current({ requirementId: 'c-other' });
    const binding = bindPriorOverrides([byId, byText], [p]);
    expect(binding.bound.get('same-id')?.via).toBe('requirement_id');
    expect(binding.bound.has('c-other')).toBe(false);
    expect(binding.lostOverrides).toBe(0);
  });

  it('an unmatched prior override counts as lost', () => {
    const p = prior({ requirementText: 'Vanished requirement wording' });
    const c = current({ requirementText: 'Completely new requirement' });
    const binding = bindPriorOverrides([c], [p]);
    expect(binding.bound.size).toBe(0);
    expect(binding.lostOverrides).toBe(1);
  });

  it('empty prior set binds nothing and loses nothing', () => {
    const binding = bindPriorOverrides([current()], []);
    expect(binding.bound.size).toBe(0);
    expect(binding.lostOverrides).toBe(0);
  });
});

describe('resolveGapRows', () => {
  const assignment: GapAssignment = {
    requirementId: 'c1111111-1111-4111-8111-111111111111',
    classification: 'genuine_gap',
    rationale: 'No named-skill evidence.',
  };

  it('a fresh row carries the engine values and no override state', () => {
    const [row] = resolveGapRows([assignment], { bound: new Map(), lostOverrides: 0 });
    expect(row).toEqual({
      requirementId: assignment.requirementId,
      classification: 'genuine_gap',
      engineClassification: 'genuine_gap',
      rationale: 'No named-skill evidence.',
      userOverridden: false,
      overrideNote: null,
      carriedVia: null,
    });
  });

  it('a carried row keeps FRESH engine_classification/rationale and rides the override', () => {
    const p = prior({ classification: 'have', overrideNote: 'fictional why' });
    const bound = new Map([[assignment.requirementId, { prior: p, via: 'content' as const }]]);
    const [row] = resolveGapRows([assignment], { bound, lostOverrides: 0 });
    expect(row).toEqual({
      requirementId: assignment.requirementId,
      classification: 'have',
      engineClassification: 'genuine_gap',
      rationale: 'No named-skill evidence.',
      userOverridden: true,
      overrideNote: 'fictional why',
      carriedVia: 'content',
    });
  });
});
