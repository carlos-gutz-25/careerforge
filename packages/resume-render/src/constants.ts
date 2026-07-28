import { type ResumeExportFormat } from '@careerforge/core';

// Deterministic render constants (D4). Every value here is FIXED - no clock, no
// randomness - so a given canonical doc renders to identical bytes/content every
// time (the packages/scoring determinism class, extended to file rendering).

/** The embedded PDF font family key (IBM Plex Sans, OFL-1.1; src/fonts). */
export const PDF_FONT_FAMILY = 'IBMPlexSans';

/** DOCX does NOT embed a font - it NAMES a standard sans the consuming viewer
 *  renders (ATS-safe, universally available). */
export const DOCX_FONT_NAME = 'Arial';

/** The trailer file identifier pdfmake stamps is a random 16-byte value - the
 *  sole source of PDF nondeterminism (the M6-05 spike found no live
 *  /CreationDate). We overwrite it with this fixed, same-length (32 hex) value
 *  so the PDF is byte-reproducible. */
export const PINNED_PDF_ID = '00000000000000000000000000000000';

/** The render-fidelity honesty string (D6). This check confirms the exported
 *  bytes still contain the reviewed claims in order; it makes NO claim about any
 *  real ATS (that scoring is M6-06, kept structurally separate). */
export const RENDER_FIDELITY_HONESTY =
  'Deterministic render-fidelity check: confirms the exported file still contains every reviewed claim, in order - not a prediction of any real ATS.';

export const CONTENT_TYPES: Record<ResumeExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  markdown: 'text/markdown; charset=utf-8',
  plaintext: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

export const EXTENSIONS: Record<ResumeExportFormat, string> = {
  pdf: '.pdf',
  docx: '.docx',
  markdown: '.md',
  plaintext: '.txt',
  json: '.json',
};

/** The fixed section headings, in render order. Also the parse-audit's structural
 *  anchor labels (never dynamic values). */
export const SECTION_HEADINGS = {
  summary: 'Summary',
  experience: 'Experience',
  project: 'Projects',
  skills: 'Skills',
  education: 'Education',
} as const;
