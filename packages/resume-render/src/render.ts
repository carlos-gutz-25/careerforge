import {
  canonicalResumeDocSchema,
  type CanonicalResumeDoc,
  type ResumeExportFormat,
} from '@careerforge/core';

import { CONTENT_TYPES, EXTENSIONS } from './constants.ts';
import { renderDocx } from './formats/docx.ts';
import { renderJson } from './formats/json.ts';
import { renderMarkdown } from './formats/markdown.ts';
import { renderPdf } from './formats/pdf.ts';
import { renderPlaintext } from './formats/plaintext.ts';
import { buildLayout } from './layout.ts';

/** A rendered artifact ready to stream. `body` is a Buffer for the binary
 *  formats (pdf/docx) and a string for the text formats (markdown/plaintext/
 *  json); `contentType` and `filename` drive the response headers. */
export interface RenderedResume {
  body: Buffer | string;
  contentType: string;
  filename: string;
}

/** Content-Disposition-safe filename base: an ASCII slug of the full name, or the
 *  literal `resume` when the slug is empty after sanitization (ADVISORY-C1). */
function filenameBase(fullName: string): string {
  const slug = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${slug}-resume` : 'resume';
}

async function renderBody(
  format: ResumeExportFormat,
  doc: CanonicalResumeDoc,
): Promise<Buffer | string> {
  switch (format) {
    case 'markdown':
      return renderMarkdown(buildLayout(doc));
    case 'plaintext':
      return renderPlaintext(buildLayout(doc));
    case 'json':
      return renderJson(doc);
    case 'pdf':
      return renderPdf(doc);
    case 'docx':
      return renderDocx(doc);
  }
}

/**
 * Render a canonical resume document into one of the five deterministic export
 * formats. ASYNC because pdfmake/docx buffer production is Promise-based; the
 * text formats resolve through the same shape for one uniform call site.
 * Re-validates `doc` at entry (defense-in-depth even though the api caller also
 * safeParses on the jsonb read) - a render is total over any schema-valid doc.
 * Renders EXCLUSIVELY from the durable snapshot; nothing comes off the wire.
 */
export async function renderResume(
  format: ResumeExportFormat,
  doc: CanonicalResumeDoc,
): Promise<RenderedResume> {
  const parsed = canonicalResumeDocSchema.parse(doc);
  const body = await renderBody(format, parsed);
  return {
    body,
    contentType: CONTENT_TYPES[format],
    filename: `${filenameBase(parsed.contact.fullName)}${EXTENSIONS[format]}`,
  };
}
