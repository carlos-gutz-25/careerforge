import { type ResumeClaimDraft, type ResumeGateViolation } from '@careerforge/core';
import { type ClaimProvenanceViolation } from '@careerforge/scoring';

// M15-01 - THE PRIVACY SPINE (plan D3). One projection site turns the gate's
// in-memory violations into the SAFE record that reaches all three sinks: the
// run row's gate_violations payload, the POST 201 wire body, and (as law ids
// only) the route log.
//
// It lives in apps/api, NOT packages/scoring, deliberately. This is a WIRE
// projection: putting it in scoring would couple a pure engine's signature to
// the HTTP contract, and the API service already owns wire projection and
// already holds the claim set at the policy site. It is still pure - no I/O, no
// clock, no randomness - and unit-tested in isolation.
//
// The gate's ClaimProvenanceViolation carries optional `refs` and `token`, and
// NEITHER may leave this boundary. `token` may echo posting-derived text. `refs`
// is the subtler hazard: provenance_class refs are server-assigned and safe, but
// citation_membership pushes the refs that did NOT resolve - strings the model
// invented after reading an untrusted posting. So "keep refs, drop token" would
// be WRONG, and both are dropped.

/**
 * Project gate violations onto their safe, recordable shape.
 *
 * Built by CONSTRUCTION: it NAMES its four output fields and never spreads the
 * source violation. That distinction is load-bearing - a filter that deletes
 * known-bad keys can be defeated by a field added later, while a constructor
 * that names its outputs cannot leak one nobody wrote.
 *
 * `section` is zipped from the claim set because it is the only thing that makes
 * `claimIndex` legible to a reader: a flagged run persists no claims.
 */
export function toSafeGateViolations(
  violations: ClaimProvenanceViolation[],
  claims: ResumeClaimDraft[],
): ResumeGateViolation[] {
  return violations.map((violation) => {
    const claim = claims[violation.claimIndex];
    // Structurally unreachable: the gate returns indices into the very array it
    // was handed, in the same synchronous call. Reaching it means the gate and
    // the service disagree about the claim set, which is a corruption condition,
    // so it throws rather than under-reporting. Silently skipping the violation
    // would be the exact failure mode this story exists to fix, and a nullable
    // `section` would add a wire state to model an impossible case. Same idiom
    // as the six existing 'unreachable: ...' throws in the service.
    if (claim === undefined)
      throw new Error(
        `unreachable: gate violation claimIndex ${String(violation.claimIndex)} has no claim`,
      );

    const safe: ResumeGateViolation = {
      claimIndex: violation.claimIndex,
      section: claim.section,
      law: violation.law,
    };
    // The shape law's sub-rules are a closed vocabulary defined in core, so they
    // carry no untrusted text. Copied, not aliased, so the caller cannot mutate
    // the gate's own array through the projection.
    if (violation.detail !== undefined) safe.detail = [...violation.detail];
    return safe;
  });
}
