import { type CanonicalResumeDoc } from '@careerforge/core';
import { Document, Packer, Paragraph, TextRun } from 'docx';

import { DOCX_FONT_NAME } from '../constants.ts';
import { buildLayout } from '../layout.ts';

// DOCX renderer (single column, standard headings, real text - ATS-safe, D3).
// Does NOT embed a font: it NAMES a standard sans the consuming viewer renders.
// Dynamic strings are placed as plain text runs (no markdown parsing) - the
// untrusted-text rendering-side law. Determinism (D4): the docx library's public
// API exposes no core.xml created/modified pin, and the zip carries non-pinnable
// per-entry wobble, so DOCX is CONTENT-deterministic (mammoth-extracted text +
// structure), NOT byte-deterministic - the M6-05 spike outcome (V2-PLAN 56).
// `revision` is pinned for hygiene; content golden is what the fidelity gate
// tests.

function run(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text,
    font: DOCX_FONT_NAME,
    size: opts.size ?? 20,
    ...(opts.bold ? { bold: true } : {}),
    ...(opts.color ? { color: opts.color } : {}),
  });
}

export async function renderDocx(doc: CanonicalResumeDoc): Promise<Buffer> {
  const layout = buildLayout(doc);
  const children: Paragraph[] = [
    new Paragraph({ children: [run(layout.name, { bold: true, size: 40 })] }),
  ];
  if (layout.headline)
    children.push(new Paragraph({ children: [run(layout.headline, { size: 22 })] }));
  if (layout.contactLine)
    children.push(
      new Paragraph({ children: [run(layout.contactLine, { size: 18, color: '444444' })] }),
    );
  for (const link of layout.links) {
    children.push(
      new Paragraph({
        children: [run(`${link.label}: ${link.url}`, { size: 18, color: '444444' })],
      }),
    );
  }

  for (const section of layout.sections) {
    children.push(
      new Paragraph({
        spacing: { before: 240, after: 80 },
        children: [run(section.heading, { bold: true, size: 26 })],
      }),
    );
    for (const group of section.groups) {
      if (group.subheading)
        children.push(
          new Paragraph({
            spacing: { before: 80 },
            children: [run(group.subheading, { bold: true, size: 22 })],
          }),
        );
      for (const line of group.lines) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: [run(line)] }));
      }
    }
  }

  const document = new Document({
    creator: 'CareerForge',
    title: 'Resume',
    revision: 1,
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}
