import { type ResumeClaimDraft } from '@careerforge/core';
import { type ClaimProvenanceViolation } from '@careerforge/scoring';
import { describe, expect, it } from 'vitest';

import { toSafeGateViolations } from './gate-violations.ts';

// M15-01 - the privacy spine's unit legs (plan D3 + PF-2). ALL data fictional.
// The projection is pure, so these run with no DB and no app.

const claims: ResumeClaimDraft[] = [
  {
    text: 'Grew throughput by 99% on the ingest path.',
    section: 'summary',
    entityRef: null,
    citationRefs: ['ev-1'],
  },
  {
    text: 'Shipped the ingest pipeline.',
    section: 'experience',
    entityRef: 'exp-1',
    citationRefs: ['ev-missing'],
  },
  {
    text: 'Built the parser.',
    section: 'project',
    entityRef: 'proj-1',
    citationRefs: ['ev-2'],
  },
];

/** Both hazards live in ONE fixture, which is the point: a `token`-bearing
 *  violation (a fabricated number the model wrote after reading the posting) and
 *  a `refs`-bearing one (the citation refs that did NOT resolve, i.e. strings the
 *  model invented). A rule of "drop token, keep refs" would pass a weaker test. */
const violations: ClaimProvenanceViolation[] = [
  { claimIndex: 0, law: 'numeric', token: '99' },
  { claimIndex: 1, law: 'citation_membership', refs: ['ev-missing'] },
  { claimIndex: 2, law: 'shape', detail: ['entity_ref_unknown', 'claim_text_cap'] },
];

describe('toSafeGateViolations', () => {
  it('projects claimIndex, section, law and detail - and nothing else', () => {
    const safe = toSafeGateViolations(violations, claims);

    // (i) NON-EMPTY first. Every assertion below passes vacuously on [], which is
    // exactly how a neutered projection would sneak through (the M12-04 lesson).
    expect(safe).toHaveLength(3);

    // (ii) the exact expected objects, deep-equal.
    expect(safe).toEqual([
      { claimIndex: 0, section: 'summary', law: 'numeric' },
      { claimIndex: 1, section: 'experience', law: 'citation_membership' },
      {
        claimIndex: 2,
        section: 'project',
        law: 'shape',
        detail: ['entity_ref_unknown', 'claim_text_cap'],
      },
    ]);

    // (iii) the SERIALIZED form carries neither hazard key. toEqual alone would
    // not catch a key whose value is undefined; the payload-unique JSON key form
    // is what pins it.
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('"token":');
    expect(serialized).not.toContain('"refs":');
    // and not the values either, since those are the untrusted strings.
    expect(serialized).not.toContain('ev-missing');
    expect(serialized).not.toContain('"99"');
  });

  it('drops token and refs even when EVERY violation carries one', () => {
    const allHazards: ClaimProvenanceViolation[] = [
      { claimIndex: 0, law: 'numeric', token: '99' },
      { claimIndex: 1, law: 'provenance_class', refs: ['ev-1'] },
    ];
    const safe = toSafeGateViolations(allHazards, claims);
    expect(safe).toHaveLength(2);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('"token":');
    expect(serialized).not.toContain('"refs":');
  });

  it('omits detail entirely for a non-shape law', () => {
    const safe = toSafeGateViolations([{ claimIndex: 0, law: 'numeric', token: '99' }], claims);
    expect(safe).toEqual([{ claimIndex: 0, section: 'summary', law: 'numeric' }]);
    expect(JSON.stringify(safe)).not.toContain('detail');
  });

  it('copies detail rather than aliasing the gate array', () => {
    const source: ClaimProvenanceViolation[] = [
      { claimIndex: 0, law: 'shape', detail: ['summary_total_cap'] },
    ];
    const safe = toSafeGateViolations(source, claims);
    safe[0]?.detail?.push('claim_text_cap');
    expect(source[0]?.detail).toEqual(['summary_total_cap']);
  });

  it('returns [] for no violations', () => {
    expect(toSafeGateViolations([], claims)).toEqual([]);
  });

  it('THROWS on a claimIndex with no claim rather than under-reporting', () => {
    // D3: structurally unreachable - the gate indexes the array it was handed.
    // Reaching it means the gate and the service disagree about the claim set,
    // which is corruption. Silently skipping would UNDER-REPORT, the exact
    // failure this story exists to fix, so the branch throws.
    expect(() => toSafeGateViolations([{ claimIndex: 7, law: 'numeric' }], claims)).toThrow(
      /^unreachable: gate violation claimIndex 7 has no claim$/,
    );
  });
});
