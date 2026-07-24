import { describe, expect, it } from 'vitest';

import {
  buildLearningPayload,
  type LearningEvidenceInput,
  type LearningGapInput,
} from './learning-payload.ts';

// Pure unit tests for the learning-plan payload builder (M3-01). All data
// fictional. The headline is SYNTACTIC recurrence ranking: same
// normalizeWhitespace(requirementText) across >=2 DISTINCT postings ranks
// first, computed deterministically (never the model's judgment).

const SKILLS = [{ name: 'TypeScript', level: 'solid' as const }];

function gap(
  overrides: Partial<LearningGapInput> & Pick<LearningGapInput, 'gapId'>,
): LearningGapInput {
  return {
    classification: 'genuine_gap',
    requirementId: `req-${overrides.gapId}`,
    fitReportId: `report-${overrides.gapId}`,
    postingId: `posting-${overrides.gapId}`,
    requirementText: 'Some requirement',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    rationale: 'no evidence',
    ...overrides,
  };
}

function parsePayload(payload: string): {
  gaps: { ref: string; requirement: string; seenInNPostings: number; evidence: unknown[] }[];
} {
  return JSON.parse(payload) as never;
}

describe('buildLearningPayload', () => {
  it("excludes 'have' gaps from the payload and the eligible count", () => {
    const built = buildLearningPayload(
      SKILLS,
      [
        gap({ gapId: 'a', classification: 'have' }),
        gap({ gapId: 'b', classification: 'genuine_gap' }),
      ],
      [],
    );
    expect(built.eligibleGapCount).toBe(1);
    expect(parsePayload(built.payload).gaps).toHaveLength(1);
    expect([...built.gapIdByRef.values()]).toEqual(['b']);
  });

  it('ranks a requirement recurring across >=2 DISTINCT postings ahead of a single-posting gap', () => {
    // Same requirement text in postings X and Y; a different requirement in Z.
    const built = buildLearningPayload(
      SKILLS,
      [
        gap({ gapId: 'z1', postingId: 'Z', requirementText: 'Solo requirement' }),
        gap({ gapId: 'x1', postingId: 'X', requirementText: 'Recurring requirement' }),
        gap({ gapId: 'y1', postingId: 'Y', requirementText: 'Recurring requirement' }),
      ],
      [],
    );
    const parsed = parsePayload(built.payload);
    // The two recurring gaps rank first (seenInNPostings=2), solo last.
    expect(parsed.gaps.map((g) => g.seenInNPostings)).toEqual([2, 2, 1]);
    expect(parsed.gaps[0]?.requirement).toBe('Recurring requirement');
    expect(parsed.gaps[2]?.requirement).toBe('Solo requirement');
    // Two separate items, NOT merged (the ratified residual).
    expect(parsed.gaps.filter((g) => g.requirement === 'Recurring requirement')).toHaveLength(2);
  });

  it('counts DISTINCT POSTINGS, not reports: same text in two reports of ONE posting is not recurring', () => {
    const built = buildLearningPayload(
      SKILLS,
      [
        gap({ gapId: 'r1', postingId: 'P', fitReportId: 'report-1', requirementText: 'Same text' }),
        gap({ gapId: 'r2', postingId: 'P', fitReportId: 'report-2', requirementText: 'Same text' }),
      ],
      [],
    );
    // Both share posting P → one distinct posting → seenInNPostings = 1.
    expect(parsePayload(built.payload).gaps.map((g) => g.seenInNPostings)).toEqual([1, 1]);
  });

  it('recurrence is whitespace-insensitive but CASE- and punctuation-SENSITIVE (conservative)', () => {
    const whitespace = buildLearningPayload(
      SKILLS,
      [
        gap({ gapId: 'w1', postingId: 'A', requirementText: 'Kafka  streams' }),
        gap({ gapId: 'w2', postingId: 'B', requirementText: 'Kafka streams' }),
      ],
      [],
    );
    // normalizeWhitespace collapses the double space → recurring.
    expect(parsePayload(whitespace.payload).gaps.every((g) => g.seenInNPostings === 2)).toBe(true);

    const caseDiff = buildLearningPayload(
      SKILLS,
      [
        gap({ gapId: 'c1', postingId: 'A', requirementText: 'Kafka' }),
        gap({ gapId: 'c2', postingId: 'B', requirementText: 'kafka' }),
      ],
      [],
    );
    // Case differs → NOT merged (under-count, never overclaim).
    expect(parsePayload(caseDiff.payload).gaps.every((g) => g.seenInNPostings === 1)).toBe(true);
  });

  it('attaches evidence by (fitReportId, requirementId) — no cross-report bleed', () => {
    const target = gap({
      gapId: 'g1',
      fitReportId: 'report-1',
      requirementId: 'req-1',
      requirementText: 'Needs evidence',
    });
    const evidence: LearningEvidenceInput[] = [
      // Right report + requirement: attaches.
      {
        fitReportId: 'report-1',
        requirementId: 'req-1',
        strength: 'direct',
        postingQuote: 'PQ-own',
        profileQuote: 'own',
      },
      // Same requirement id, DIFFERENT report: must NOT attach.
      {
        fitReportId: 'report-OTHER',
        requirementId: 'req-1',
        strength: 'direct',
        postingQuote: 'PQ-bleed',
        profileQuote: 'bleed',
      },
    ];
    const built = buildLearningPayload(SKILLS, [target], evidence);
    const parsed = parsePayload(built.payload);
    const evidenceJson = JSON.stringify(parsed.gaps[0]?.evidence);
    expect(evidenceJson).toContain('PQ-own');
    expect(evidenceJson).not.toContain('PQ-bleed');
  });
});
