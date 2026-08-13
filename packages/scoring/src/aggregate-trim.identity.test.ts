import type { ClaimEvidenceSource, ClaimProvenanceEntities } from './index.ts';
import { checkClaimProvenance } from './index.ts';
import type { ResumeClaimDraft, ResumeGateViolation } from '@careerforge/core';
import {
  RESUME_MAX_CLAIMS,
  RESUME_MAX_CLAIMS_PER_EXPERIENCE,
  RESUME_MAX_CLAIMS_PER_PROJECT,
  RESUME_SUMMARY_TOTAL_MAX_CHARS,
  isAggregateOnlyViolationSet,
  trimAggregateOverflow,
} from '@careerforge/core';
import { describe, expect, it } from 'vitest';

// M15-03 D6 leg 1 - THE PROVABLE-IDENTITY PROPERTY, and the whole story's
// rationale rests on it. The review-seat ruling (2026-08-06, adopted over the
// original model-ordering rationale) claims that for all four aggregate caps,
// "drop from the end of the offending group until the cap is satisfied" is
// IDENTICAL to "drop exactly the claims the gate flagged".
//
// This file proves it against the REAL gate rather than a restatement of it -
// which is why it lives in packages/scoring, the only package that can import
// both the gate and core's trim. If any cap disagrees here, the plan says STOP
// and report: the degrade policy would not be enforcement, it would be editing.
//
// The SECOND assertion in each case is the stronger one and the real payload:
// re-running the gate over the trimmed claims returns ok. That is what makes the
// degraded document "precisely the claims that passed every one of the six laws".
//
// ALL DATA FICTIONAL.

/** Text of a given length carrying no digits, no skill tokens and no pointers,
 *  so the five truthfulness laws stay silent and only a SIZE cap can fire. */
const filler = (length: number): string =>
  'Led the ingest work for the team. '.repeat(Math.ceil(length / 34)).slice(0, length);

/**
 * The same, but DISTINGUISHABLE per claim - and that distinctness is load-bearing,
 * not cosmetic. With identical claim objects `toEqual` cannot tell WHICH claim a
 * trim dropped, so a trim that removes the wrong element still deep-equals the
 * right answer and the identity assertion silently passes. That is not a
 * hypothetical: the first version of this file used identical fixtures, and the
 * control below caught only ONE of the four caps until this was added.
 *
 * The marker is a run of letters, never digits - a digit would wake the numeric
 * law and the fixture would stop isolating a single aggregate cap.
 */
const uniqueFiller = (length: number, index: number): string =>
  `${'x'.repeat(index + 1)} ${filler(length)}`.slice(0, length);

const evidenceFor = (refs: { ref: string; kind: 'experience' | 'project'; entity: string }[]) =>
  refs.map(({ ref, kind, entity }): ClaimEvidenceSource => ({
    ref,
    sourceText: filler(120),
    owner: { kind, entityRef: entity },
    provenance: 'professional',
  }));

/** Zip the gate's raw violations into core's SAFE shape, exactly as the service's
 *  projection does - section comes from the claim set. */
const toSafe = (
  violations: { claimIndex: number; law: string; detail?: string[] }[],
  claims: ResumeClaimDraft[],
): ResumeGateViolation[] =>
  violations.map((violation) => {
    const claim = claims[violation.claimIndex];
    if (claim === undefined)
      throw new Error(`violation index ${violation.claimIndex} has no claim`);
    return {
      claimIndex: violation.claimIndex,
      section: claim.section,
      law: violation.law,
      ...(violation.detail === undefined ? {} : { detail: violation.detail }),
    } as ResumeGateViolation;
  });

interface Fixture {
  claims: ResumeClaimDraft[];
  evidence: ClaimEvidenceSource[];
  entities: ClaimProvenanceEntities;
}

/** claim_count_cap ALONE: 41 claims spread thin enough across experiences that no
 *  per-entity cap can also fire. */
function claimCountFixture(): Fixture {
  const experiences = Array.from({ length: 9 }, (_, k) => `exp-${k}`);
  const claims = Array.from({ length: RESUME_MAX_CLAIMS + 1 }, (_, i) => ({
    text: uniqueFiller(60, i),
    section: 'experience' as const,
    entityRef: experiences[i % experiences.length] as string,
    citationRefs: [`ev-${i % experiences.length}`],
  }));
  return {
    claims,
    evidence: evidenceFor(
      experiences.map((entity, k) => ({ ref: `ev-${k}`, kind: 'experience' as const, entity })),
    ),
    entities: { experiences, projects: [] },
  };
}

/** experience_claim_cap ALONE: one experience carrying one claim too many. */
function experienceCapFixture(): Fixture {
  const claims = Array.from({ length: RESUME_MAX_CLAIMS_PER_EXPERIENCE + 1 }, (_, i) => ({
    text: uniqueFiller(60, i),
    section: 'experience' as const,
    entityRef: 'exp-1',
    citationRefs: ['ev-1'],
  }));
  return {
    claims,
    evidence: evidenceFor([{ ref: 'ev-1', kind: 'experience', entity: 'exp-1' }]),
    entities: { experiences: ['exp-1'], projects: [] },
  };
}

/** project_claim_cap ALONE. */
function projectCapFixture(): Fixture {
  const claims = Array.from({ length: RESUME_MAX_CLAIMS_PER_PROJECT + 1 }, (_, i) => ({
    text: uniqueFiller(60, i),
    section: 'project' as const,
    entityRef: 'proj-1',
    citationRefs: ['ev-p'],
  }));
  return {
    claims,
    evidence: evidenceFor([{ ref: 'ev-p', kind: 'project', entity: 'proj-1' }]),
    entities: { experiences: [], projects: ['proj-1'] },
  };
}

/** summary_total_cap ALONE: three summary claims, each well under the per-claim
 *  300 cap, whose running total crosses 600 at the third. */
function summaryTotalFixture(): Fixture {
  const claims = Array.from({ length: 3 }, (_, i) => ({
    text: uniqueFiller(250, i),
    section: 'summary' as const,
    entityRef: null,
    citationRefs: ['ev-1'],
  }));
  return {
    claims,
    evidence: evidenceFor([{ ref: 'ev-1', kind: 'experience', entity: 'exp-1' }]),
    entities: { experiences: ['exp-1'], projects: [] },
  };
}

const cases: [string, () => Fixture, string, number[]][] = [
  ['claim_count_cap', claimCountFixture, 'claim_count_cap', [RESUME_MAX_CLAIMS]],
  [
    'experience_claim_cap',
    experienceCapFixture,
    'experience_claim_cap',
    [RESUME_MAX_CLAIMS_PER_EXPERIENCE],
  ],
  ['project_claim_cap', projectCapFixture, 'project_claim_cap', [RESUME_MAX_CLAIMS_PER_PROJECT]],
  ['summary_total_cap', summaryTotalFixture, 'summary_total_cap', [2]],
];

describe('M15-03 provable identity: trimmed set == the gate flagged set', () => {
  it.each(cases)('%s', (_label, build, expectedRule, expectedFlagged) => {
    const { claims, evidence, entities } = build();
    const verdict = checkClaimProvenance({ claims, evidence, entities, skillVocabulary: [] });

    // The fixture must isolate ONE aggregate cap: if a truthfulness law also
    // fired, the fixture is wrong and the identity claim is untested.
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    const safe = toSafe(verdict.violations, claims);
    expect(isAggregateOnlyViolationSet(safe)).toBe(true);
    for (const violation of safe) {
      expect(violation.law).toBe('shape');
      expect(violation.detail).toEqual([expectedRule]);
    }

    // (1) THE IDENTITY: the flagged set is exactly the set the trim removes.
    const flagged = safe.map((violation) => violation.claimIndex).sort((a, b) => a - b);
    expect(flagged).toEqual(expectedFlagged);
    const result = trimAggregateOverflow(claims, safe);
    const survivingOriginalIndices = claims
      .map((_, index) => index)
      .filter((index) => !flagged.includes(index));
    expect(result.claims).toEqual(survivingOriginalIndices.map((index) => claims[index]));
    expect(result.disclosure.droppedCount).toBe(flagged.length);
    expect(result.disclosure.caps).toEqual([expectedRule]);

    // (2) THE STRONGER PROPERTY: what survives PASSES the gate. This is what
    // licenses persisting a degraded document at all - every retained claim
    // cleared all six laws, so the trim is enforcement rather than editing.
    const after = checkClaimProvenance({
      claims: result.claims,
      evidence,
      entities,
      skillVocabulary: [],
    });
    expect(after).toEqual({ ok: true });
  });

  it('the summary fixture really does cross the 600 cap (fixture control)', () => {
    const { claims } = summaryTotalFixture();
    const total = claims.reduce((sum, claim) => sum + claim.text.length, 0);
    expect(total).toBeGreaterThan(RESUME_SUMMARY_TOTAL_MAX_CHARS);
    // and the surviving prefix is lawful BY CONSTRUCTION, not by luck
    expect(claims[0]!.text.length + claims[1]!.text.length).toBeLessThanOrEqual(
      RESUME_SUMMARY_TOTAL_MAX_CHARS,
    );
  });
});
