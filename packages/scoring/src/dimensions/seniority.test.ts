import { tokenizeForMatching, type ProfileExperience } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import { demandedYears, professionalSpanYears } from './seniority.ts';

// Clock-free date math: every figure derives from input dates and the
// caller-supplied referenceDate. All fixture data fictional.

function experience(over: Partial<ProfileExperience>): ProfileExperience {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    company: 'Fictional Gizmo Works',
    title: 'Software Engineer',
    startDate: '2020-01-01',
    endDate: null,
    ...over,
  };
}

describe('professionalSpanYears', () => {
  it('closes an open experience at the reference date', () => {
    expect(professionalSpanYears([experience({})], '2026-01-01')).toBe(6);
  });

  it('merges overlapping stints — concurrent roles never double-count', () => {
    const overlapping = [
      experience({
        id: 'a1111111-1111-4111-8111-111111111111',
        startDate: '2018-01-01',
        endDate: '2021-01-01',
      }),
      experience({
        id: 'b2222222-2222-4222-8222-222222222222',
        startDate: '2020-01-01',
        endDate: '2022-01-01',
      }),
    ];
    expect(professionalSpanYears(overlapping, '2026-01-01')).toBe(4);
  });

  it('sums disjoint stints across a gap', () => {
    const gapped = [
      experience({
        id: 'a1111111-1111-4111-8111-111111111111',
        startDate: '2015-01-01',
        endDate: '2017-01-01',
      }),
      experience({
        id: 'b2222222-2222-4222-8222-222222222222',
        startDate: '2019-01-01',
        endDate: '2021-01-01',
      }),
    ];
    expect(professionalSpanYears(gapped, '2026-01-01')).toBe(4);
  });

  it('empty history = 0; future-dated starts contribute nothing', () => {
    expect(professionalSpanYears([], '2026-01-01')).toBe(0);
    expect(professionalSpanYears([experience({ startDate: '2027-06-01' })], '2026-01-01')).toBe(0);
  });
});

describe('demandedYears', () => {
  it.each([
    ['plain figure', '8+ years of experience', 8],
    ['figure with plus stripped by normalization', '12+ years', 12],
    ['one intervening token', '5 professional years', 5],
    ['no year vocabulary', 'senior platform role', undefined],
    ['year token too far from the figure', '3 releases across many years', undefined],
  ])('%s', (_name, text, expected) => {
    expect(demandedYears(tokenizeForMatching(text))).toBe(expected);
  });
});
