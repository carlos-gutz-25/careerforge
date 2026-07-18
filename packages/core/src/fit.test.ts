import { describe, expect, it } from 'vitest';

import { HARD_FILTER_KEYS, hardFiltersSchema } from './criteria.ts';
import { FIT_DIMENSIONS } from './enums.ts';
import {
  evidenceLinkSchema,
  exclusionVerdictSchema,
  FIT_REVIEW_NOTES_MAX_CHARS,
  fitReportDataSchema,
  fitReportResponseSchema,
  fitReviewBodySchema,
  fitReviewResponseSchema,
  forcedLowestSchema,
  postingFitResponseSchema,
  scoringRequirementSchema,
  unscoredRequirementSchema,
  type EvidenceLink,
  type FitReportData,
  type FitReportResponse,
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

// --- M1-10 wire contracts ---

function wireReport(overrides: Partial<FitReportResponse> = {}): FitReportResponse {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    postingId: '99999999-9999-4999-8999-999999999999',
    extractionRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    reviewStatus: 'draft',
    notes: null,
    createdAt: '2026-07-18T12:00:00.000Z',
    report: report(),
    ...overrides,
  };
}

describe('fitReportResponseSchema (M1-10 wire)', () => {
  it('round-trips a canonical wire report — the engine payload nests intact', () => {
    expect(fitReportResponseSchema.parse(wireReport())).toEqual(wireReport());
  });

  it('round-trips a reviewed report with notes', () => {
    const reviewed = wireReport({ reviewStatus: 'reviewed', notes: 'fictional review note' });
    expect(fitReportResponseSchema.parse(reviewed)).toEqual(reviewed);
  });

  it.each([
    ['a merged percent beside the payload', { ...wireReport(), matchPercent: 87 }],
    ['a merged score beside the payload', { ...wireReport(), overallScore: 0.7 }],
    [
      'a merged score inside the nested payload',
      { ...wireReport(), report: { ...report(), overallScore: 0.7 } },
    ],
    [
      'a payload violating the verdict mirror law',
      { ...wireReport(), report: { ...report(), verdict: 'excluded' } },
    ],
    ['an unknown reviewStatus', { ...wireReport(), reviewStatus: 'approved' }],
  ])('rejects %s — no merged overall score is representable on the wire', (_name, invalid) => {
    expect(fitReportResponseSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('postingFitResponseSchema', () => {
  it('serves report: null before the first scoring (empty collection, not 404)', () => {
    expect(postingFitResponseSchema.parse({ report: null })).toEqual({ report: null });
  });

  it('serves the wire report when one exists', () => {
    expect(postingFitResponseSchema.parse({ report: wireReport() })).toEqual({
      report: wireReport(),
    });
  });

  it('rejects a merged score beside the envelope key', () => {
    expect(
      postingFitResponseSchema.safeParse({ report: wireReport(), matchPercent: 87 }).success,
    ).toBe(false);
  });
});

describe('fitReviewBodySchema', () => {
  it.each([
    ['notes present', { notes: 'fictional note about a fictional posting' }, true],
    ['notes null (body-less POST reaches the validator as null)', { notes: null }, true],
    ['notes absent', {}, true],
    ['a NUL character in notes (value-free 400, never a DB 500)', { notes: 'a\u0000b' }, false],
    ['notes beyond the cap', { notes: 'x'.repeat(FIT_REVIEW_NOTES_MAX_CHARS + 1) }, false],
    ['an unknown key', { notes: 'ok', reviewStatus: 'reviewed' }, false],
  ])('%s -> valid: %s', (_name, body, valid) => {
    expect(fitReviewBodySchema.safeParse(body).success).toBe(valid);
  });
});

describe('fitReviewResponseSchema', () => {
  it('is meta-only and strict', () => {
    const meta = {
      id: '88888888-8888-4888-8888-888888888888',
      reviewStatus: 'reviewed',
      notes: 'fictional review note',
    };
    expect(fitReviewResponseSchema.parse(meta)).toEqual(meta);
    expect(fitReviewResponseSchema.safeParse({ ...meta, report: report() }).success).toBe(false);
  });
});
