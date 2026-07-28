import {
  type CanonicalResumeDoc,
  type ParseAuditReport,
  type ResumeAuditFormat,
} from '@careerforge/core';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { RENDER_FIDELITY_HONESTY } from './constants.ts';
import { buildLayout, normalizeInline } from './layout.ts';

// Parse-audit (D6, the NEW verification gate). Re-reads text back out of a
// rendered PDF/DOCX and computes TWO SEPARATE, NEVER-MERGED render-fidelity
// results (V2-PLAN 59 "never one merged score") + a fixed honesty string. This
// is RENDER-FIDELITY only (did the bytes we produced still contain, in order,
// exactly the reviewed claims) - it needs the canonical doc + the rendered
// bytes, NO job posting. Coverage-vs-posting is M6-06, kept structurally
// separate. Used both by resume-render's own fidelity tests AND the api
// parse-audit endpoint - hence pdf-parse/mammoth are runtime deps.

/** Collapse whitespace runs (PDF/DOCX text extraction reflows lines) so a claim
 *  emitted with single-space normalization matches verbatim. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Extract the plain text back out of a rendered binary artifact - pdf-parse for
 *  PDF, mammoth for DOCX. Exported so the determinism harness reuses the SAME
 *  extraction for its content-goldens (PDF and DOCX are content-deterministic,
 *  not byte-deterministic; the M6-05 spike outcome). */
export async function extractArtifactText(
  format: ResumeAuditFormat,
  bytes: Buffer,
): Promise<string> {
  if (format === 'pdf') {
    // Copy into a fresh Uint8Array so the parser cannot take ownership of / mutate
    // the caller's buffer.
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    const result = await parser.getText();
    return result.text;
  }
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value;
}

export async function auditParse(
  format: ResumeAuditFormat,
  bytes: Buffer,
  doc: CanonicalResumeDoc,
): Promise<ParseAuditReport> {
  const extracted = flatten(await extractArtifactText(format, bytes));
  const layout = buildLayout(doc);

  // Structural anchors, IN RENDER ORDER: the name (reported under the LABEL
  // `contact.fullName`, never its value) then each rendered section heading (the
  // heading names are fixed labels, safe to report as-is). ADVISORY-C2.
  const anchors: { label: string; needle: string }[] = [
    { label: 'contact.fullName', needle: layout.name },
    ...layout.sections.map((section) => ({ label: section.heading, needle: section.heading })),
  ];

  const missing: string[] = [];
  const outOfOrder: string[] = [];
  let lastIndex = -1;
  for (const anchor of anchors) {
    const at = anchor.needle === '' ? -1 : extracted.indexOf(anchor.needle);
    if (at === -1) {
      missing.push(anchor.label);
      continue;
    }
    if (at < lastIndex) outOfOrder.push(anchor.label);
    lastIndex = at;
  }

  // Evidence: every claim's text survives verbatim (normalized for the whitespace
  // reflow). Dropped claims are reported by POSITION only, never by text (D10).
  const missingClaims: number[] = [];
  for (const claim of doc.claims) {
    const needle = normalizeInline(claim.text);
    if (needle !== '' && !extracted.includes(needle)) missingClaims.push(claim.position);
  }
  missingClaims.sort((a, b) => a - b);

  return {
    parseIntegrity: { ok: missing.length === 0 && outOfOrder.length === 0, missing, outOfOrder },
    evidenceIntegrity: { ok: missingClaims.length === 0, missingClaims },
    honesty: RENDER_FIDELITY_HONESTY,
  };
}
