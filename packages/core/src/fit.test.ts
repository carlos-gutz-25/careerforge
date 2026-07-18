import { describe, expect, it } from 'vitest';

import { HARD_FILTER_KEYS, hardFiltersSchema } from './criteria.ts';
import { FIT_DIMENSIONS } from './enums.ts';
import {
  evidenceLinkSchema,
  exclusionVerdictSchema,
  fitReportDataSchema,
  forcedLowestSchema,
  scoringRequirementSchema,
  unscoredRequirementSchema,
  type EvidenceLink,
  type FitReportData,
  type SubScore,
} from './fit.ts';

// All fixture data is fictional (RISKS P-01).

function evidenceLink(overrides: Partial<EvidenceLink> = {}): EvidenceLink {
  return {
    requirementId: '33333333-3333-4333-8333-333333333333',
    profileSkillId: '44444444-4444-4444-8444-444444444444',
    profileProjectId: null,
    profileExperienceId: null,
    postingQuote: '5+ years TypeScript',
    profileQuote: 'typescript — expert, 8 yrs',
    strength: 'direct',
    ...overrides,
  };
}

function subScores(): SubScore[] {
  return FIT_DIMENSIONS.map((dimension) => ({
    dimension,
    score: 0.5,
    rationale: `fictional ${dimension} rationale`,
    evidence: [],
  }));
}

function report(overrides: Partial<FitReportData> = {}): FitReportData {
  return {
    verdict: 'scored',
    exclusions: [],
    subScores: subScores(),
    unscoredRequirements: [],
    forcedLowestPriority: { applied: false, matchedSlugs: [] },
    inputFlagged: false,
    ...overrides,
  };
}

const EXCLUSION = {
  filterKey: 'employment_type',
  matchedValue: 'contract',
  postingQuote: 'This is a 6-month contract position.',
} as const;

describe('HARD_FILTER_KEYS', () => {
  it('is complete against hardFiltersSchema — no schema key missing from the list', () => {
    // `satisfies` already pins the other direction (every listed key exists
    // in the schema); this pins completeness at runtime.
    expect(new Set(HARD_FILTER_KEYS)).toEqual(new Set(Object.keys(hardFiltersSchema.shape)));
  });
});

describe('scoringRequirementSchema', () => {
  it('is the wire Requirement plus position (A4 canonicalization input)', () => {
    const row = {
      id: '55555555-5555-4555-8555-555555555555',
      kind: 'must_have',
      category: 'language',
      text: 'TypeScript experience',
      sourceQuote: '5+ years TypeScript',
      quoteVerified: null, // tristate: NULL = not yet verified
      confidence: 0.9,
      position: 0,
    };
    expect(scoringRequirementSchema.parse(row)).toEqual(row);
    expect(scoringRequirementSchema.safeParse({ ...row, position: -1 }).success).toBe(false);
    const withoutPosition: Record<string, unknown> = { ...row };
    delete withoutPosition.position;
    expect(scoringRequirementSchema.safeParse(withoutPosition).success).toBe(false);
  });
});

describe('exclusionVerdictSchema', () => {
  it('accepts a fired filter with quote evidence', () => {
    expect(exclusionVerdictSchema.parse(EXCLUSION)).toEqual(EXCLUSION);
  });

  it.each([
    ['a quote-free exclusion is unrepresentable (D6)', { ...EXCLUSION, postingQuote: '' }],
    ['an empty matchedValue is rejected', { ...EXCLUSION, matchedValue: '' }],
    [
      'a key outside the closed exclude_when set is rejected',
      { ...EXCLUSION, filterKey: 'problem_domains' },
    ],
  ])('%s', (_name, invalid) => {
    expect(exclusionVerdictSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('evidenceLinkSchema strength law', () => {
  it.each([
    ['direct with a named skill', evidenceLink(), true],
    ['partial with a named skill', evidenceLink({ strength: 'partial' }), true],
    [
      'adjacent without a named skill (project text)',
      evidenceLink({
        strength: 'adjacent',
        profileSkillId: null,
        profileProjectId: '66666666-6666-4666-8666-666666666666',
        profileQuote: 'Fictional Analytics Migration — event pipeline rework',
      }),
      true,
    ],
    ['direct WITHOUT a named skill', evidenceLink({ profileSkillId: null }), false],
    [
      'partial WITHOUT a named skill',
      evidenceLink({ strength: 'partial', profileSkillId: null }),
      false,
    ],
    ['adjacent WITH a named skill', evidenceLink({ strength: 'adjacent' }), false],
    ['empty profileQuote (both sides required)', evidenceLink({ profileQuote: '' }), false],
    ['empty postingQuote (both sides required)', evidenceLink({ postingQuote: '' }), false],
  ])('%s -> valid: %s', (_name, link, valid) => {
    expect(evidenceLinkSchema.safeParse(link).success).toBe(valid);
  });
});

describe('forcedLowestSchema (flag never clamp, D8)', () => {
  it.each([
    ['not applied, no slugs', { applied: false, matchedSlugs: [] }, true],
    ['applied with the matched slug', { applied: true, matchedSlugs: ['defense'] }, true],
    ['applied=true with NO slugs cannot exist', { applied: true, matchedSlugs: [] }, false],
    ['applied=false WITH slugs cannot exist', { applied: false, matchedSlugs: ['defense'] }, false],
    ['non-slug values rejected', { applied: true, matchedSlugs: ['Not A Slug'] }, false],
  ])('%s -> valid: %s', (_name, value, valid) => {
    expect(forcedLowestSchema.safeParse(value).success).toBe(valid);
  });
});

describe('unscoredRequirementSchema', () => {
  it('carries a distinct verification-state reason (D3/A6)', () => {
    const id = '77777777-7777-4777-8777-777777777777';
    expect(
      unscoredRequirementSchema.parse({ requirementId: id, reason: 'failed_verification' }).reason,
    ).toBe('failed_verification');
    expect(
      unscoredRequirementSchema.parse({ requirementId: id, reason: 'not_yet_verified' }).reason,
    ).toBe('not_yet_verified');
    expect(
      unscoredRequirementSchema.safeParse({ requirementId: id, reason: 'unverified' }).success,
    ).toBe(false);
  });
});

describe('fitReportDataSchema structural laws', () => {
  it('accepts a scored report with all seven dimensions', () => {
    expect(fitReportDataSchema.parse(report())).toEqual(report());
  });

  it('accepts an excluded report — sub-scores still present and informative', () => {
    const excluded = report({ verdict: 'excluded', exclusions: [EXCLUSION] });
    expect(fitReportDataSchema.parse(excluded)).toEqual(excluded);
  });

  it.each([
    ['verdict excluded with ZERO exclusions', report({ verdict: 'excluded' })],
    ['verdict scored with a fired exclusion', report({ exclusions: [EXCLUSION] })],
    ['a missing dimension', report({ subScores: subScores().slice(1) })],
    [
      'a duplicated dimension',
      report({
        subScores: [...subScores().slice(1), { ...subScores()[0]!, dimension: 'technical' }],
      }),
    ],
    ['a score above 1', report({ subScores: subScores().map((s) => ({ ...s, score: 1.5 })) })],
    [
      'an empty rationale',
      report({ subScores: subScores().map((s) => ({ ...s, rationale: '' })) }),
    ],
  ])('rejects %s', (_name, invalid) => {
    expect(fitReportDataSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects unknown keys — no merged overall score can enter the payload', () => {
    expect(fitReportDataSchema.safeParse({ ...report(), overallScore: 0.7 }).success).toBe(false);
  });
});
