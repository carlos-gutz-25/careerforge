import { type CanonicalResumeDoc } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import { auditParse } from './audit.ts';
import { RENDER_FIDELITY_HONESTY } from './constants.ts';
import { CANONICAL_DOC_FIXTURE } from './__fixtures__/canonical-doc.fixture.ts';
import { renderResume } from './render.ts';

const AUDIT_FORMATS = ['pdf', 'docx'] as const;

async function renderBuf(
  format: (typeof AUDIT_FORMATS)[number],
  doc: CanonicalResumeDoc,
): Promise<Buffer> {
  return (await renderResume(format, doc)).body as Buffer;
}

describe('auditParse round-trip (D6)', () => {
  for (const format of AUDIT_FORMATS) {
    it(`${format}: a faithful render passes BOTH integrity checks with the honesty string`, async () => {
      const buf = await renderBuf(format, CANONICAL_DOC_FIXTURE);
      const report = await auditParse(format, buf, CANONICAL_DOC_FIXTURE);
      // Two SEPARATE, never-merged results (V2-PLAN 59).
      expect(report.parseIntegrity).toEqual({ ok: true, missing: [], outOfOrder: [] });
      expect(report.evidenceIntegrity).toEqual({ ok: true, missingClaims: [] });
      expect(report.honesty).toBe(RENDER_FIDELITY_HONESTY);
    });
  }

  it('the honesty string is render-fidelity only - NOT an ATS-coverage claim (D7 boundary)', () => {
    expect(RENDER_FIDELITY_HONESTY).toContain('not a prediction of any real ATS');
    expect(RENDER_FIDELITY_HONESTY).toContain('every reviewed claim, in order');
  });

  it('missing structural anchors report LABELS only, never dynamic values (D10 / ADVISORY-C2)', async () => {
    // Render a REDUCED doc (same Jordan Rivera contact + the summary claim only)
    // and audit it against the FULL canonical doc: the name + Summary survive, but
    // the later section anchors + their claims are absent from the artifact.
    const reduced: CanonicalResumeDoc = {
      ...CANONICAL_DOC_FIXTURE,
      skills: [],
      education: [],
      claims: CANONICAL_DOC_FIXTURE.claims.filter((claim) => claim.section === 'summary'),
    };
    const buf = await renderBuf('pdf', reduced);
    const report = await auditParse('pdf', buf, CANONICAL_DOC_FIXTURE);
    expect(report.parseIntegrity.ok).toBe(false);
    // The anchor labels are the fixed heading names (safe), never a claim/name value.
    expect(report.parseIntegrity.missing).toEqual([
      'Experience',
      'Projects',
      'Skills',
      'Education',
    ]);
    expect(report.evidenceIntegrity.ok).toBe(false);
    expect(report.evidenceIntegrity.missingClaims).toEqual([1, 2, 3, 4]);
  });
});

// D-GATE-3 (the parse-audit gate's demonstrated planted-FAIL): a TAMPERED
// artifact - a PDF/DOCX rendered from a doc with one claim removed, audited
// against the FULL reviewed doc - must be caught (evidenceIntegrity.ok=false with
// the dropped claim's POSITION). Neutering auditParse to always return
// { ok: true } makes THESE assertions fail (the tamper would slip through);
// restoring catches it. Neuter demonstrated + captured in the PR.
describe('D-GATE-3: tamper detection', () => {
  for (const format of AUDIT_FORMATS) {
    it(`${format}: an artifact missing the position-3 claim is caught by position`, async () => {
      const tampered: CanonicalResumeDoc = {
        ...CANONICAL_DOC_FIXTURE,
        claims: CANONICAL_DOC_FIXTURE.claims.filter((claim) => claim.position !== 3),
      };
      const buf = await renderBuf(format, tampered);
      const report = await auditParse(format, buf, CANONICAL_DOC_FIXTURE);
      expect(report.evidenceIntegrity.ok).toBe(false);
      expect(report.evidenceIntegrity.missingClaims).toContain(3);
    });
  }
});
