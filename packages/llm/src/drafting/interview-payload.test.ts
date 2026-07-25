import { describe, expect, it } from 'vitest';

import {
  buildInterviewPayload,
  INTERVIEW_EVIDENCE_PER_REQUIREMENT_CAP,
  type InterviewEvidenceInput,
  type InterviewRequirementInput,
  type InterviewSkillInput,
} from './interview-payload.ts';

// All fixture data is fictional (RISKS P-01).

const SKILLS: InterviewSkillInput[] = [
  { name: 'TypeScript', level: 'expert' },
  { name: 'Kubernetes', level: 'learning' },
];

function requirement(
  overrides: Partial<InterviewRequirementInput> = {},
): InterviewRequirementInput {
  return {
    requirementId: 'req-1',
    quoteVerified: true,
    text: 'TypeScript experience',
    kind: 'must_have',
    category: 'language',
    gap: null,
    ...overrides,
  };
}

function evidence(overrides: Partial<InterviewEvidenceInput> = {}): InterviewEvidenceInput {
  return {
    evidenceLinkId: 'link-1',
    requirementId: 'req-1',
    strength: 'direct',
    postingQuote: 'TypeScript experience',
    profileQuote: 'Shipped a fictional TypeScript platform',
    ...overrides,
  };
}

function parsePayload(payload: string): {
  profileSkills: unknown[];
  requirements: Record<string, unknown>[];
} {
  return JSON.parse(payload) as never;
}

describe('buildInterviewPayload verified filter (gate condition 1)', () => {
  it('includes ONLY quoteVerified === true — false AND null are excluded and counted', () => {
    const result = buildInterviewPayload(
      SKILLS,
      [
        requirement({ requirementId: 'req-1', quoteVerified: true }),
        requirement({ requirementId: 'req-2', quoteVerified: false, text: 'Failed verification' }),
        requirement({ requirementId: 'req-3', quoteVerified: null, text: 'Never verified' }),
      ],
      [],
    );
    expect(result.verifiedRequirementCount).toBe(1);
    expect(result.excludedRequirementCount).toBe(2);
    expect([...result.requirementIdByRef.entries()]).toEqual([['r1', 'req-1']]);
    const parsed = parsePayload(result.payload);
    expect(parsed.requirements).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain('Failed verification');
    expect(JSON.stringify(parsed)).not.toContain('Never verified');
  });

  it('all-unverified input yields verifiedRequirementCount 0 (the pre-paid 409 signal)', () => {
    const result = buildInterviewPayload(
      SKILLS,
      [requirement({ quoteVerified: false }), requirement({ quoteVerified: null })],
      [],
    );
    expect(result.verifiedRequirementCount).toBe(0);
    expect(result.excludedRequirementCount).toBe(2);
    expect(parsePayload(result.payload).requirements).toEqual([]);
  });

  it('drops evidence belonging to an excluded requirement entirely', () => {
    const result = buildInterviewPayload(
      SKILLS,
      [
        requirement({ requirementId: 'req-1', quoteVerified: true }),
        requirement({ requirementId: 'req-2', quoteVerified: null }),
      ],
      [
        evidence({ evidenceLinkId: 'link-1', requirementId: 'req-1' }),
        evidence({
          evidenceLinkId: 'link-2',
          requirementId: 'req-2',
          profileQuote: 'Quote of an unverified requirement',
        }),
      ],
    );
    expect(result.evidenceByRef.size).toBe(1);
    expect(result.payload).not.toContain('Quote of an unverified requirement');
  });
});

describe('buildInterviewPayload gap handling (gate condition 2)', () => {
  it('a no-gap-row requirement serializes WITHOUT a classification and carries no obligation', () => {
    const result = buildInterviewPayload(SKILLS, [requirement({ gap: null })], []);
    const [row] = parsePayload(result.payload).requirements;
    expect(row).not.toHaveProperty('gapClassification');
    expect(result.gapByRequirementRef.size).toBe(0);
    expect(result.disclosureRequiredRefs.size).toBe(0);
  });

  it('a have gap resolves server-side but does NOT oblige a disclosure', () => {
    const result = buildInterviewPayload(
      SKILLS,
      [requirement({ gap: { gapId: 'gap-1', classification: 'have' } })],
      [],
    );
    expect(result.gapByRequirementRef.get('r1')).toEqual({
      gapId: 'gap-1',
      classification: 'have',
    });
    expect(result.disclosureRequiredRefs.has('r1')).toBe(false);
  });

  it('every non-have classification obliges a disclosure on its ref', () => {
    const classifications = [
      'have_undemonstrated',
      'needs_refresh',
      'genuine_gap',
      'low_priority',
    ] as const;
    const result = buildInterviewPayload(
      SKILLS,
      classifications.map((classification, index) =>
        requirement({
          requirementId: `req-${String(index + 1)}`,
          gap: { gapId: `gap-${String(index + 1)}`, classification },
        }),
      ),
      [],
    );
    expect(result.disclosureRequiredRefs).toEqual(new Set(['r1', 'r2', 'r3', 'r4']));
    const parsed = parsePayload(result.payload);
    expect(parsed.requirements.map((row) => row['gapClassification'])).toEqual([
      ...classifications,
    ]);
  });
});

describe('buildInterviewPayload evidence refs', () => {
  it('numbers e-refs globally in requirement order, keyed to their OWN requirement', () => {
    const result = buildInterviewPayload(
      SKILLS,
      [
        requirement({ requirementId: 'req-1' }),
        requirement({ requirementId: 'req-2', text: 'Kubernetes operations' }),
      ],
      [
        evidence({ evidenceLinkId: 'link-a', requirementId: 'req-1' }),
        evidence({ evidenceLinkId: 'link-b', requirementId: 'req-2' }),
        evidence({ evidenceLinkId: 'link-c', requirementId: 'req-1' }),
      ],
    );
    // req-1's two links number first (e1, e2), then req-2's (e3).
    expect([...result.evidenceByRef.entries()]).toEqual([
      ['e1', { evidenceLinkId: 'link-a', requirementRef: 'r1' }],
      ['e2', { evidenceLinkId: 'link-c', requirementRef: 'r1' }],
      ['e3', { evidenceLinkId: 'link-b', requirementRef: 'r2' }],
    ]);
    const parsed = parsePayload(result.payload);
    expect((parsed.requirements[0]!['evidence'] as { ref: string }[]).map((e) => e.ref)).toEqual([
      'e1',
      'e2',
    ]);
    expect((parsed.requirements[1]!['evidence'] as { ref: string }[]).map((e) => e.ref)).toEqual([
      'e3',
    ]);
  });

  it('caps evidence per requirement at the documented cap', () => {
    const links = Array.from({ length: INTERVIEW_EVIDENCE_PER_REQUIREMENT_CAP + 2 }, (_, i) =>
      evidence({ evidenceLinkId: `link-${String(i + 1)}` }),
    );
    const result = buildInterviewPayload(SKILLS, [requirement()], links);
    expect(result.evidenceByRef.size).toBe(INTERVIEW_EVIDENCE_PER_REQUIREMENT_CAP);
    const [row] = parsePayload(result.payload).requirements;
    expect(row!['evidence']).toHaveLength(INTERVIEW_EVIDENCE_PER_REQUIREMENT_CAP);
  });
});

describe('buildInterviewPayload document shape', () => {
  it('serializes profile skills and requirement display fields verbatim', () => {
    const result = buildInterviewPayload(
      SKILLS,
      [requirement({ gap: { gapId: 'gap-1', classification: 'genuine_gap' } })],
      [evidence()],
    );
    const parsed = parsePayload(result.payload);
    expect(parsed.profileSkills).toEqual([
      { name: 'TypeScript', level: 'expert' },
      { name: 'Kubernetes', level: 'learning' },
    ]);
    expect(parsed.requirements[0]).toEqual({
      ref: 'r1',
      kind: 'must_have',
      category: 'language',
      requirement: 'TypeScript experience',
      gapClassification: 'genuine_gap',
      evidence: [
        {
          ref: 'e1',
          strength: 'direct',
          postingQuote: 'TypeScript experience',
          profileQuote: 'Shipped a fictional TypeScript platform',
        },
      ],
    });
  });
});
