import { describe, expect, it } from 'vitest';

import {
  INTERVIEW_PREP_MAX_POINTS_PER_QUESTION,
  INTERVIEW_PREP_MAX_QUESTIONS,
  INTERVIEW_PREP_REVIEW_NOTES_MAX_CHARS,
  INTERVIEW_PREP_TEXT_MAX_CHARS,
  interviewPrepPointSchema,
  interviewPrepQuestionSchema,
  interviewPrepResponseSchema,
  interviewPrepReviewBodySchema,
  interviewPrepRunSchema,
  interviewPrepSchema,
  type InterviewPrep,
  type InterviewPrepEvidencePoint,
  type InterviewPrepGapDisclosurePoint,
  type InterviewPrepQuestion,
  type InterviewPrepRun,
} from './interview.ts';

// All fixture data is fictional (RISKS P-01).

function runRow(overrides: Partial<InterviewPrepRun> = {}): InterviewPrepRun {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    promptId: 'interview-prep@v1',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    status: 'ok',
    attempt: 1,
    inputTokens: 2600,
    outputTokens: 900,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 6100,
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

function evidencePoint(
  overrides: Partial<InterviewPrepEvidencePoint> = {},
): InterviewPrepEvidencePoint {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    type: 'evidence',
    text: 'Walk through the queue consumer you built and how you load-tested it.',
    position: 0,
    evidenceLinkId: '66666666-6666-4666-8666-666666666666',
    evidenceStrength: 'direct',
    evidencePostingQuote: 'experience operating message queues in production',
    evidenceProfileQuote: 'Built and operated a RabbitMQ consumer fleet',
    ...overrides,
  };
}

function gapPoint(
  overrides: Partial<InterviewPrepGapDisclosurePoint> = {},
): InterviewPrepGapDisclosurePoint {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    type: 'gap_disclosure',
    text: 'Be upfront: no production Kubernetes operations yet; the learning plan covers it.',
    position: 1,
    gapId: '88888888-8888-4888-8888-888888888888',
    gapClassification: 'genuine_gap',
    learningPlans: [
      { id: '99999999-9999-4999-8999-999999999999', title: 'Close the Kubernetes gap' },
    ],
    ...overrides,
  };
}

function questionRow(overrides: Partial<InterviewPrepQuestion> = {}): InterviewPrepQuestion {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    kind: 'technical',
    question: 'How would you run this service on Kubernetes, given your queue background?',
    position: 0,
    requirementId: '33333333-3333-4333-8333-333333333333',
    requirementText: 'Kubernetes operations experience',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    points: [evidencePoint(), gapPoint()],
    ...overrides,
  };
}

function prepRow(overrides: Partial<InterviewPrep> = {}): InterviewPrep {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    fitReportId: '22222222-2222-4222-8222-222222222222',
    reviewStatus: 'draft',
    notes: null,
    createdAt: '2026-01-02T03:04:06.000Z',
    questions: [questionRow()],
    ...overrides,
  };
}

describe('drafting caps', () => {
  it('pins the v1 output bounds the LLM schema derives from', () => {
    expect(INTERVIEW_PREP_MAX_QUESTIONS).toBe(15);
    expect(INTERVIEW_PREP_MAX_POINTS_PER_QUESTION).toBe(4);
    expect(INTERVIEW_PREP_TEXT_MAX_CHARS).toBe(400);
  });
});

describe('interviewPrepRunSchema', () => {
  it('accepts an ok run and every terminal status in the vocabulary', () => {
    expect(interviewPrepRunSchema.parse(runRow())).toEqual(runRow());
    for (const status of ['schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'] as const) {
      expect(interviewPrepRunSchema.safeParse(runRow({ status })).success).toBe(true);
    }
  });

  it('is strict and never carries rawResponse or userId', () => {
    expect(
      interviewPrepRunSchema.safeParse({ ...runRow(), rawResponse: { any: 'thing' } }).success,
    ).toBe(false);
    expect(interviewPrepRunSchema.safeParse({ ...runRow(), userId: 'u-1' }).success).toBe(false);
  });

  it('rejects an unknown status and a zero attempt', () => {
    expect(interviewPrepRunSchema.safeParse(runRow({ status: 'partial' as never })).success).toBe(
      false,
    );
    expect(interviewPrepRunSchema.safeParse(runRow({ attempt: 0 })).success).toBe(false);
  });
});

describe('interviewPrepPointSchema (discriminated union)', () => {
  it('accepts both point shapes', () => {
    expect(interviewPrepPointSchema.parse(evidencePoint())).toEqual(evidencePoint());
    expect(interviewPrepPointSchema.parse(gapPoint())).toEqual(gapPoint());
  });

  it('the shapes are structurally exclusive — no field of one rides on the other', () => {
    // An evidence point cannot carry gap fields...
    expect(interviewPrepPointSchema.safeParse({ ...evidencePoint(), gapId: 'g-1' }).success).toBe(
      false,
    );
    expect(
      interviewPrepPointSchema.safeParse({ ...evidencePoint(), gapClassification: 'genuine_gap' })
        .success,
    ).toBe(false);
    // ...and a disclosure cannot cite an evidence link.
    expect(
      interviewPrepPointSchema.safeParse({ ...gapPoint(), evidenceLinkId: 'e-1' }).success,
    ).toBe(false);
    // An unknown discriminant never parses.
    expect(
      interviewPrepPointSchema.safeParse({ ...evidencePoint(), type: 'anecdote' }).success,
    ).toBe(false);
  });

  it('a disclosure always carries the server-resolved classification and pointer list (gate condition 3)', () => {
    // The classification badge and the learningPlans pointer are the wire's
    // authoritative honesty surface — a disclosure without them is malformed.
    const noClassification: Record<string, unknown> = { ...gapPoint() };
    delete noClassification.gapClassification;
    expect(interviewPrepPointSchema.safeParse(noClassification).success).toBe(false);
    const noPointer: Record<string, unknown> = { ...gapPoint() };
    delete noPointer.learningPlans;
    expect(interviewPrepPointSchema.safeParse(noPointer).success).toBe(false);
    // Empty pointer list is valid — it IS the honest "not yet planned".
    expect(interviewPrepPointSchema.safeParse(gapPoint({ learningPlans: [] })).success).toBe(true);
    // The pointer rows are strict meta (id + title only).
    expect(
      interviewPrepPointSchema.safeParse(
        gapPoint({
          learningPlans: [{ id: 'p-1', title: 't', gapCount: 2 } as never],
        }),
      ).success,
    ).toBe(false);
  });
});

describe('interviewPrepQuestionSchema', () => {
  it('accepts a drafted question with its joined requirement display fields', () => {
    expect(interviewPrepQuestionSchema.parse(questionRow())).toEqual(questionRow());
  });

  it('rejects vocabulary strays in kind', () => {
    expect(
      interviewPrepQuestionSchema.safeParse(questionRow({ kind: 'situational' as never })).success,
    ).toBe(false);
    expect(interviewPrepQuestionSchema.safeParse(questionRow({ kind: 'behavioral' })).success).toBe(
      true,
    );
  });

  it('is strict — no extra keys ride along', () => {
    expect(interviewPrepQuestionSchema.safeParse({ ...questionRow(), score: 0.9 }).success).toBe(
      false,
    );
  });
});

describe('interviewPrepResponseSchema', () => {
  it('accepts the not-yet-drafted empty collection', () => {
    const empty = { run: null, prep: null, cached: false };
    expect(interviewPrepResponseSchema.parse(empty)).toEqual(empty);
  });

  it('accepts a non-ok terminal draft (run present, prep null)', () => {
    const failed = {
      run: runRow({ status: 'flagged', attempt: 1 }),
      prep: null,
      cached: false,
    };
    expect(interviewPrepResponseSchema.parse(failed)).toEqual(failed);
  });

  it('accepts a drafted prep and the cached re-serve', () => {
    const fresh = { run: runRow(), prep: prepRow(), cached: false };
    expect(interviewPrepResponseSchema.parse(fresh)).toEqual(fresh);
    const cached = { run: runRow(), prep: prepRow(), cached: true };
    expect(interviewPrepResponseSchema.parse(cached)).toEqual(cached);
  });

  it('questions and points nest intact through the prep shape', () => {
    const prep = prepRow({
      questions: [
        questionRow(),
        questionRow({ position: 1, kind: 'behavioral', points: [gapPoint({ position: 0 })] }),
      ],
    });
    expect(interviewPrepSchema.parse(prep)).toEqual(prep);
  });
});

describe('interviewPrepReviewBodySchema', () => {
  it('accepts absent, null, and real notes (nullish — a body-less POST arrives as null)', () => {
    expect(interviewPrepReviewBodySchema.safeParse({}).success).toBe(true);
    expect(interviewPrepReviewBodySchema.safeParse({ notes: null }).success).toBe(true);
    expect(
      interviewPrepReviewBodySchema.safeParse({ notes: 'Solid set; soften question 3.' }).success,
    ).toBe(true);
  });

  it('rejects U+0000 and over-cap notes at the boundary (value-free 400, never a 500)', () => {
    expect(interviewPrepReviewBodySchema.safeParse({ notes: 'a\u0000b' }).success).toBe(false);
    expect(
      interviewPrepReviewBodySchema.safeParse({
        notes: 'x'.repeat(INTERVIEW_PREP_REVIEW_NOTES_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });
});
