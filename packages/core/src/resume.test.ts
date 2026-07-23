import { describe, expect, it } from 'vitest';

import {
  fitReportResumeVariantResponseSchema,
  RESUME_VARIANT_REVIEW_NOTES_MAX_CHARS,
  resumeVariantCitationSchema,
  resumeVariantEntrySchema,
  resumeVariantResponseSchema,
  resumeVariantReviewBodySchema,
  resumeVariantRunSchema,
  type ResumeVariantEntry,
  type ResumeVariantResponse,
  type ResumeVariantRun,
} from './resume.ts';

// All fixture data is fictional (RISKS P-01) — the Alex Rivera persona.

function runRow(overrides: Partial<ResumeVariantRun> = {}): ResumeVariantRun {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    promptId: 'resume-tailoring@v1',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    status: 'ok',
    attempt: 1,
    inputTokens: 2600,
    outputTokens: 640,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 4800,
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

function entryRow(overrides: Partial<ResumeVariantEntry> = {}): ResumeVariantEntry {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    section: 'skill',
    position: 0,
    label: 'TypeScript',
    detail: 'expert · 8 yrs · last used 2026',
    emphasis: 'lead',
    reason: 'Emphasized in light of the primary language requirement.',
    citations: [
      {
        gapId: '66666666-6666-4666-8666-666666666666',
        gapClassification: 'have',
        requirementId: '33333333-3333-4333-8333-333333333333',
        requirementText: 'Strong TypeScript background',
        requirementKind: 'must_have',
        requirementCategory: 'language',
      },
    ],
    ...overrides,
  };
}

function variantRow(overrides: Partial<ResumeVariantResponse> = {}): ResumeVariantResponse {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    fitReportId: '22222222-2222-4222-8222-222222222222',
    reviewStatus: 'draft',
    notes: null,
    createdAt: '2026-01-02T03:04:06.000Z',
    renderedMarkdown: '# Tailored resume variant (draft)\n',
    entries: [entryRow()],
    ...overrides,
  };
}

describe('resumeVariantRunSchema', () => {
  it('accepts an ok run and every terminal status in the vocabulary', () => {
    expect(resumeVariantRunSchema.parse(runRow())).toEqual(runRow());
    for (const status of ['schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'] as const) {
      expect(resumeVariantRunSchema.safeParse(runRow({ status })).success).toBe(true);
    }
  });

  it('is strict and never carries rawResponse or userId', () => {
    expect(
      resumeVariantRunSchema.safeParse({ ...runRow(), rawResponse: { any: 'thing' } }).success,
    ).toBe(false);
    expect(resumeVariantRunSchema.safeParse({ ...runRow(), userId: 'u-1' }).success).toBe(false);
  });

  it('rejects an unknown status and a zero attempt', () => {
    expect(resumeVariantRunSchema.safeParse(runRow({ status: 'partial' as never })).success).toBe(
      false,
    );
    expect(resumeVariantRunSchema.safeParse(runRow({ attempt: 0 })).success).toBe(false);
  });
});

describe('resumeVariantCitationSchema', () => {
  it('accepts a joined citation with its gap display fields', () => {
    expect(resumeVariantCitationSchema.parse(entryRow().citations[0])).toEqual(
      entryRow().citations[0],
    );
  });

  it('rejects vocabulary strays and extra keys', () => {
    expect(
      resumeVariantCitationSchema.safeParse({
        ...entryRow().citations[0],
        gapClassification: 'wont_fix',
      }).success,
    ).toBe(false);
    expect(
      resumeVariantCitationSchema.safeParse({ ...entryRow().citations[0], score: 0.9 }).success,
    ).toBe(false);
  });
});

describe('resumeVariantEntrySchema', () => {
  it('accepts a rendered entry with joined citations', () => {
    expect(resumeVariantEntrySchema.parse(entryRow())).toEqual(entryRow());
  });

  it('accepts a standard-weight entry (emphasis and reason both null, no citations)', () => {
    const standard = entryRow({ emphasis: null, reason: null, citations: [] });
    expect(resumeVariantEntrySchema.parse(standard)).toEqual(standard);
  });

  it('accepts every section and rejects a stray section', () => {
    for (const section of ['skill', 'experience', 'project'] as const) {
      expect(resumeVariantEntrySchema.safeParse(entryRow({ section })).success).toBe(true);
    }
    expect(
      resumeVariantEntrySchema.safeParse(entryRow({ section: 'summary' as never })).success,
    ).toBe(false);
  });

  it('rejects a stray emphasis level and extra keys', () => {
    expect(
      resumeVariantEntrySchema.safeParse(entryRow({ emphasis: 'bold' as never })).success,
    ).toBe(false);
    expect(resumeVariantEntrySchema.safeParse({ ...entryRow(), companyName: 'x' }).success).toBe(
      false,
    );
  });
});

describe('fitReportResumeVariantResponseSchema', () => {
  it('accepts the not-yet-drafted empty collection', () => {
    const empty = { run: null, variant: null, cached: false };
    expect(fitReportResumeVariantResponseSchema.parse(empty)).toEqual(empty);
  });

  it('accepts a non-ok terminal draft (run present, variant null)', () => {
    const failed = {
      run: runRow({ status: 'schema_failed', attempt: 2 }),
      variant: null,
      cached: false,
    };
    expect(fitReportResumeVariantResponseSchema.parse(failed)).toEqual(failed);
  });

  it('accepts the flagged spec-validation outcome (run flagged, variant null)', () => {
    const flagged = { run: runRow({ status: 'flagged' }), variant: null, cached: false };
    expect(fitReportResumeVariantResponseSchema.parse(flagged)).toEqual(flagged);
  });

  it('accepts a drafted variant and the cached re-serve', () => {
    const fresh = { run: runRow(), variant: variantRow(), cached: false };
    expect(fitReportResumeVariantResponseSchema.parse(fresh)).toEqual(fresh);
    const cached = { run: runRow(), variant: variantRow(), cached: true };
    expect(fitReportResumeVariantResponseSchema.parse(cached)).toEqual(cached);
  });

  it('entries nest intact through the variant shape', () => {
    const variant = variantRow({
      entries: [
        entryRow(),
        entryRow({
          id: 'e2',
          section: 'project',
          position: 1,
          emphasis: null,
          reason: null,
          citations: [],
        }),
      ],
    });
    expect(resumeVariantResponseSchema.parse(variant)).toEqual(variant);
  });
});

describe('resumeVariantReviewBodySchema', () => {
  it('accepts absent, null, and real notes (nullish — a body-less POST arrives as null)', () => {
    expect(resumeVariantReviewBodySchema.safeParse({}).success).toBe(true);
    expect(resumeVariantReviewBodySchema.safeParse({ notes: null }).success).toBe(true);
    expect(
      resumeVariantReviewBodySchema.safeParse({ notes: 'Looks honest; export it.' }).success,
    ).toBe(true);
  });

  it('rejects U+0000 and over-cap notes at the boundary (value-free 400, never a 500)', () => {
    expect(resumeVariantReviewBodySchema.safeParse({ notes: 'a\u0000b' }).success).toBe(false);
    expect(
      resumeVariantReviewBodySchema.safeParse({
        notes: 'x'.repeat(RESUME_VARIANT_REVIEW_NOTES_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });
});
