import { type ClaimEvidenceSource, type ClaimProvenanceEntities } from '@careerforge/scoring';
import { type ComposeEntities, type ComposeEvidenceItem } from '@careerforge/llm';
import { describe, expect, it } from 'vitest';

// M6-04 obligation 5 (M6-03 D2c): the compile-time assignability pin between the
// compose builder's sent-set types (packages/llm ComposeEvidenceItem /
// ComposeEntities) and the claim-provenance gate's input types (packages/scoring
// ClaimEvidenceSource / ClaimProvenanceEntities). The two are copied
// field-for-field across the module wall (M6-04 is the only site importing both
// packages), so this is where drift MUST be caught. The service passes the
// builder's evidence/entities straight into checkClaimProvenance with no cast -
// that call site is the live pin; these bidirectional assertions make any drift
// (a changed owner.kind member, a diverged optionality, a renamed field) a NAMED
// typecheck failure here rather than a surprising error at the call site.

type AssertAssignable<A, B> = A extends B ? true : never;

// If either direction ever breaks, tsc fails to assign `true` to the `never`
// alias below and `pnpm typecheck` goes red - the drift is caught at compile
// time, before any test runs.
const _evidenceForward: AssertAssignable<ComposeEvidenceItem, ClaimEvidenceSource> = true;
const _evidenceReverse: AssertAssignable<ClaimEvidenceSource, ComposeEvidenceItem> = true;
const _entitiesForward: AssertAssignable<ComposeEntities, ClaimProvenanceEntities> = true;
const _entitiesReverse: AssertAssignable<ClaimProvenanceEntities, ComposeEntities> = true;

describe('compose builder <-> claim-provenance gate assignability pin (obligation 5)', () => {
  it('holds bidirectionally at compile time (the constants above are the pin)', () => {
    // Runtime body is trivial; the assertion is the four compile-time constants.
    // Referencing them keeps them from being tree-shaken / flagged unused.
    expect([_evidenceForward, _evidenceReverse, _entitiesForward, _entitiesReverse]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});
