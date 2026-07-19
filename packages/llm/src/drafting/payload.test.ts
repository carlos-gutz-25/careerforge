import { describe, expect, it } from 'vitest';

import {
  buildDraftingPayload,
  EVIDENCE_PER_GAP_CAP,
  mapCitedRefs,
  type DraftingEvidenceInput,
  type DraftingGapInput,
} from './payload.ts';

// All fixture data is fictional (RISKS P-01).

function gapInput(overrides: Partial<DraftingGapInput> = {}): DraftingGapInput {
  return {
    gapId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    classification: 'genuine_gap',
    requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    requirementText: 'Kubernetes operations experience',
    requirementKind: 'must_have',
    requirementCategory: 'other',
    rationale: 'No named-skill evidence links this requirement.',
    ...overrides,
  };
}

function evidenceInput(overrides: Partial<DraftingEvidenceInput> = {}): DraftingEvidenceInput {
  return {
    requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    strength: 'partial',
    postingQuote: 'must run production Kubernetes',
    profileQuote: 'operated a fictional staging cluster',
    ...overrides,
  };
}

describe('buildDraftingPayload', () => {
  it('numbers eligible gaps g1..gN in order and maps refs to gap ids', () => {
    const built = buildDraftingPayload(
      [{ name: 'TypeScript', level: 'expert' }],
      [
        gapInput({ gapId: 'gap-one' }),
        gapInput({ gapId: 'gap-two', requirementText: 'GraphQL federation' }),
      ],
      [],
    );
    expect(built.eligibleGapCount).toBe(2);
    expect([...built.gapIdByRef.entries()]).toEqual([
      ['g1', 'gap-one'],
      ['g2', 'gap-two'],
    ]);
    const parsed = JSON.parse(built.payload) as {
      profileSkills: unknown[];
      gaps: { ref: string; requirement: string }[];
    };
    expect(parsed.gaps.map((gap) => gap.ref)).toEqual(['g1', 'g2']);
    expect(parsed.profileSkills).toEqual([{ name: 'TypeScript', level: 'expert' }]);
  });

  it("excludes 'have' gaps entirely — text, rationale, and ref slot", () => {
    const built = buildDraftingPayload(
      [],
      [
        gapInput({ gapId: 'gap-have', classification: 'have', requirementText: 'HAVE-ONLY-TEXT' }),
        gapInput({ gapId: 'gap-real' }),
      ],
      [],
    );
    expect(built.eligibleGapCount).toBe(1);
    expect(built.payload).not.toContain('HAVE-ONLY-TEXT');
    // The surviving gap takes g1 — refs number the eligible set, not the input.
    expect([...built.gapIdByRef.entries()]).toEqual([['g1', 'gap-real']]);
  });

  it('R3 pin: evidence whose requirement has NO eligible gap has zero presence in the payload', () => {
    // An unverified/unscored requirement never gets a gap row (scoring
    // eligibility is quoteVerified === true only), so its evidence — if any
    // reached the caller — must vanish here rather than ride along.
    const built = buildDraftingPayload(
      [],
      [gapInput()],
      [
        evidenceInput(),
        evidenceInput({
          requirementId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          postingQuote: 'STRAY-POSTING-QUOTE-MUST-NOT-APPEAR',
          profileQuote: 'STRAY-PROFILE-QUOTE-MUST-NOT-APPEAR',
        }),
      ],
    );
    expect(built.payload).toContain('must run production Kubernetes');
    expect(built.payload).not.toContain('STRAY-POSTING-QUOTE-MUST-NOT-APPEAR');
    expect(built.payload).not.toContain('STRAY-PROFILE-QUOTE-MUST-NOT-APPEAR');
  });

  it('caps evidence per gap at EVIDENCE_PER_GAP_CAP, keeping input order', () => {
    const built = buildDraftingPayload(
      [],
      [gapInput()],
      [
        evidenceInput({ postingQuote: 'quote-1' }),
        evidenceInput({ postingQuote: 'quote-2' }),
        evidenceInput({ postingQuote: 'quote-3' }),
        evidenceInput({ postingQuote: 'quote-4-over-cap' }),
      ],
    );
    const parsed = JSON.parse(built.payload) as { gaps: { evidence: unknown[] }[] };
    expect(parsed.gaps[0]?.evidence).toHaveLength(EVIDENCE_PER_GAP_CAP);
    expect(built.payload).toContain('quote-3');
    expect(built.payload).not.toContain('quote-4-over-cap');
  });

  it('zero eligible gaps: empty payload set, count 0 (the 409 signal)', () => {
    const built = buildDraftingPayload([], [gapInput({ classification: 'have' })], []);
    expect(built.eligibleGapCount).toBe(0);
    expect(built.gapIdByRef.size).toBe(0);
  });
});

describe('mapCitedRefs (citation validation)', () => {
  const refs = new Map([
    ['g1', 'gap-one'],
    ['g2', 'gap-two'],
  ]);

  it('maps known refs in item order, duplicates allowed', () => {
    const mapping = mapCitedRefs(['g2', 'g1', 'g2'], refs);
    expect(mapping.fabricatedRefCount).toBe(0);
    expect(mapping.gapIds).toEqual(['gap-two', 'gap-one', 'gap-two']);
  });

  it('ONE fabricated ref poisons the whole output: gapIds undefined, count reported', () => {
    const mapping = mapCitedRefs(['g1', 'g9'], refs);
    expect(mapping.gapIds).toBeUndefined();
    expect(mapping.fabricatedRefCount).toBe(1);
  });
});
