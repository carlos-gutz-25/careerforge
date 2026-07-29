import { tokenizeForMatching, type ProfileExperience } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import {
  demandedYears,
  evaluateSeniorityThreshold,
  professionalSpanYears,
  type SeniorityThreshold,
} from './seniority-threshold.ts';

// M12-02: unit contract for the SHARED seniority years-threshold evaluator
// (F3) - the single source of truth the fit dimension and the gap classifier
// both consume. Clock-free: every figure derives from input dates and the
// caller-supplied referenceDate. All fixture data is FICTIONAL (RISKS P-01).

function experience(over: Partial<ProfileExperience>): ProfileExperience {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    company: 'Fictional Gizmo Works',
    title: 'Software Engineer',
    startDate: '2020-01-01',
    endDate: null,
    ...over,
  };
}

describe('demandedYears', () => {
  it.each([
    ['plus figure - non-alnum stripped by tokenization', '5+ years', 5],
    ['plain single-digit figure', '5 years', 5],
    ['figure behind stopwords, year token within gap 1', 'at least 7 years of experience', 7],
    ['two-digit figure', '10 years', 10],
    ['no year vocabulary', 'senior platform engineer role', undefined],
  ])('%s -> %s', (_name, text, expected) => {
    expect(demandedYears(tokenizeForMatching(text))).toBe(expected);
  });

  it('with two figures, returns the FIRST that satisfies the gap-1 rule, not the leftmost figure', () => {
    // tokenizeForMatching keeps stopwords: "3 to 5 years" -> ['3','to','5','years'].
    // '3' is 3 tokens from 'years' (gap-1 fails); '5' is adjacent (gap-1 holds),
    // so 5 is the first MATCHED figure even though 3 appears first.
    expect(demandedYears(tokenizeForMatching('3 to 5 years'))).toBe(5);
  });
});

describe('professionalSpanYears', () => {
  it('closes an open experience at the reference date', () => {
    expect(professionalSpanYears([experience({})], '2026-01-01')).toBe(6);
  });

  it('merges overlapping stints so concurrent roles never double-count', () => {
    const overlapping = [
      experience({
        id: 'a1111111-1111-4111-8111-111111111111',
        company: 'Nowhere Systems Ltd',
        startDate: '2018-01-01',
        endDate: '2021-01-01',
      }),
      experience({
        id: 'b2222222-2222-4222-8222-222222222222',
        company: 'Placeholder Widgets Co',
        startDate: '2020-01-01',
        endDate: '2022-01-01',
      }),
    ];
    // Naive per-interval sum would be 3 + 2 = 5; the merged span 2018-2022 is 4.
    expect(professionalSpanYears(overlapping, '2026-01-01')).toBe(4);
  });

  it('empty history is 0 years', () => {
    expect(professionalSpanYears([], '2026-01-01')).toBe(0);
  });
});

describe('evaluateSeniorityThreshold', () => {
  const referenceDate = '2026-01-01';
  const experiences = [experience({ startDate: '2020-01-01', endDate: null })];

  it('returns undefined when the requirement states no years figure', () => {
    const tokens = tokenizeForMatching('senior platform engineer role');
    expect(evaluateSeniorityThreshold(tokens, experiences, referenceDate)).toBeUndefined();
  });

  it('is satisfied when the span meets or exceeds the demanded figure', () => {
    const tokens = tokenizeForMatching('5+ years of experience');
    const result = evaluateSeniorityThreshold(tokens, experiences, referenceDate);
    const expected: SeniorityThreshold = { demanded: 5, span: 6, satisfied: true };
    expect(result).toEqual(expected);
  });

  it('is unsatisfied when the span falls short of the demanded figure', () => {
    const tokens = tokenizeForMatching('10+ years of leadership');
    const result = evaluateSeniorityThreshold(tokens, experiences, referenceDate);
    const expected: SeniorityThreshold = { demanded: 10, span: 6, satisfied: false };
    expect(result).toEqual(expected);
  });

  it('reports the same span as professionalSpanYears for the given experiences', () => {
    const tokens = tokenizeForMatching('5 years');
    const result = evaluateSeniorityThreshold(tokens, experiences, referenceDate);
    expect(result?.span).toBe(professionalSpanYears(experiences, referenceDate));
  });
});
