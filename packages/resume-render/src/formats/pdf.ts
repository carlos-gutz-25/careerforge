import { fileURLToPath } from 'node:url';

import { type CanonicalResumeDoc } from '@careerforge/core';
import pdfMake from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import { PDF_FONT_FAMILY, PINNED_PDF_ID } from '../constants.ts';
import { buildLayout, type ResumeLayout } from '../layout.ts';

// PDF renderer (pdfmake -> pdfkit, single column, embedded OFL font, selectable
// real text - ATS-safe by construction, D3). Deterministic (D4): the embedded
// font bytes are fixed, pdfmake 0.3 emits no live /CreationDate, and the sole
// remaining nondeterministic field (the random trailer /ID) is overwritten with
// a fixed value below. Dynamic strings are placed as plain text runs (no
// markdown parsing) - the untrusted-text rendering-side law.

const FONT_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));

let fontsRegistered = false;
function ensureFonts(): void {
  if (fontsRegistered) return;
  // Restrict local file access to this package's font directory only.
  pdfMake.setLocalAccessPolicy((path: string) => path.startsWith(FONT_DIR));
  pdfMake.addFonts({
    [PDF_FONT_FAMILY]: {
      normal: `${FONT_DIR}IBMPlexSans-Regular.ttf`,
      bold: `${FONT_DIR}IBMPlexSans-Bold.ttf`,
      italics: `${FONT_DIR}IBMPlexSans-Italic.ttf`,
      bolditalics: `${FONT_DIR}IBMPlexSans-BoldItalic.ttf`,
    },
  });
  fontsRegistered = true;
}

/** Overwrite the random trailer file identifier with a fixed, same-length value
 *  (32 hex per group), preserving every byte offset so the xref stays valid. The
 *  M6-05 spike proved this is the only non-deterministic field. */
export function pinPdfId(buffer: Buffer): Buffer {
  const text = buffer.toString('latin1');
  const pinned = text.replace(
    /\/ID \[<[0-9a-fA-F]{32}> <[0-9a-fA-F]{32}>\]/g,
    `/ID [<${PINNED_PDF_ID}> <${PINNED_PDF_ID}>]`,
  );
  return Buffer.from(pinned, 'latin1');
}

function buildContent(layout: ResumeLayout): Content[] {
  const content: Content[] = [{ text: layout.name, style: 'name' }];
  if (layout.headline) content.push({ text: layout.headline, style: 'headline' });
  if (layout.contactLine) content.push({ text: layout.contactLine, style: 'contact' });
  for (const link of layout.links) {
    content.push({ text: `${link.label}: ${link.url}`, style: 'contact' });
  }

  for (const section of layout.sections) {
    content.push({ text: section.heading, style: 'section' });
    for (const group of section.groups) {
      if (group.subheading) content.push({ text: group.subheading, style: 'subheading' });
      content.push({ ul: group.lines, style: 'bullet' });
    }
  }
  return content;
}

export async function renderPdf(doc: CanonicalResumeDoc): Promise<Buffer> {
  ensureFonts();
  const layout = buildLayout(doc);
  const definition: TDocumentDefinitions = {
    info: {
      title: 'Resume',
      author: layout.name,
      creator: 'CareerForge',
      producer: 'CareerForge',
    },
    pageSize: 'LETTER',
    pageMargins: [48, 48, 48, 48],
    defaultStyle: { font: PDF_FONT_FAMILY, fontSize: 10, lineHeight: 1.15 },
    styles: {
      name: { fontSize: 20, bold: true },
      headline: { fontSize: 11, margin: [0, 2, 0, 0] },
      contact: { fontSize: 9, color: '#444444', margin: [0, 1, 0, 0] },
      section: { fontSize: 13, bold: true, margin: [0, 12, 0, 4] },
      subheading: { fontSize: 11, bold: true, margin: [0, 4, 0, 2] },
      bullet: { fontSize: 10, margin: [0, 0, 0, 2] },
    },
    content: buildContent(layout),
  };
  const buffer = await pdfMake.createPdf(definition).getBuffer();
  return pinPdfId(buffer);
}
