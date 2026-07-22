// @vitest-environment node
//
// Unit test of the provenance token → label mapping (app/utils/provenance.ts).
// This is the ALWAYS-CARRIES leg for M2-04's "displays a provenance label"
// criterion: it proves the exact display text for each storage token and the
// visible-wrong passthrough for an unknown token, with no Nuxt runtime. The
// rendered-in-DOM proof lives in case-study-page.test.ts (see that file's
// docblock for which leg carries the render assertion).
import { describe, expect, it } from 'vitest';

import { PROVENANCE_LABELS, provenanceLabel } from '../app/utils/provenance';

describe('provenanceLabel', () => {
  it('maps each storage token to its exact display label', () => {
    expect(provenanceLabel('professional')).toBe('Professional');
    expect(provenanceLabel('personal')).toBe('Personal');
    expect(provenanceLabel('personal_ai_assisted')).toBe('Personal, AI-assisted');
  });

  it('passes an unknown token through verbatim (visible-wrong, never silently absent)', () => {
    expect(provenanceLabel('somehow_slipped_the_gate')).toBe('somehow_slipped_the_gate');
  });

  it('returns empty string for a missing token', () => {
    expect(provenanceLabel(undefined)).toBe('');
    expect(provenanceLabel(null)).toBe('');
  });

  it('PROVENANCE_LABELS carries exactly the three storage tokens', () => {
    expect(Object.keys(PROVENANCE_LABELS)).toEqual([
      'professional',
      'personal',
      'personal_ai_assisted',
    ]);
  });
});
