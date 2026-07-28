import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractArtifactText } from './audit.ts';
import { CANONICAL_DOC_FIXTURE } from './__fixtures__/canonical-doc.fixture.ts';
import { renderResume } from './render.ts';

// Determinism gate (D4). Two guarantees per format: (i) DOUBLE-RENDER equality
// (catches intra-run nondeterminism - a live clock, a random id) and (ii) GOLDEN
// equality against a committed fixture rendered from the FICTIONAL canonical doc
// (catches cross-commit drift).
//
// The M6-05 spike DECIDED, per format:
//  - markdown / plaintext / json -> BYTE-golden (pure string construction).
//  - pdf -> CONTENT-golden (pdf-parse text). pdfmake emits no live /CreationDate
//    and we pin the trailer /ID, but fontkit's font-subset tables order by V8's
//    per-process hash seed, so the bytes are stable WITHIN a process yet differ
//    ACROSS processes - not reproducible in CI. The extracted TEXT is stable, and
//    text is the render-fidelity invariant that matters (R2).
//  - docx -> CONTENT-golden (mammoth text). The docx zip carries non-pinnable
//    per-entry wobble (R1).
// The per-format outcome is recorded in the BACKLOG BUILD RECORD + the ADR-0018
// determinism amendment (D12).
//
// Regenerate goldens after an INTENTIONAL layout change with `WRITE_GOLDENS=1`.
// D-GATE-1 (the gate's demonstrated planted-FAIL): mutating a claim's text in the
// fixture turns the golden assertions RED (the golden is live, not a rubber
// stamp); restoring returns them GREEN. Demonstrated in the PR.

const GOLDEN_DIR = fileURLToPath(new URL('./__fixtures__/golden/', import.meta.url));
const WRITE = process.env.WRITE_GOLDENS === '1';

const BYTE_GOLDENS = [
  { format: 'markdown', file: 'resume.md' },
  { format: 'plaintext', file: 'resume.txt' },
  { format: 'json', file: 'resume.json' },
] as const;

const CONTENT_GOLDENS = [
  { format: 'pdf', file: 'resume.pdf.txt' },
  { format: 'docx', file: 'resume.docx.txt' },
] as const;

function toBytes(body: Buffer | string): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
}

describe('determinism (D4)', () => {
  it('byte formats (markdown/plaintext/json) are byte-equal across a double render', async () => {
    for (const { format } of BYTE_GOLDENS) {
      const a = await renderResume(format, CANONICAL_DOC_FIXTURE);
      const b = await renderResume(format, CANONICAL_DOC_FIXTURE);
      expect(a.body).toBe(b.body);
    }
  });

  it('content formats (pdf/docx) are content-equal (extracted text) across a double render', async () => {
    for (const { format } of CONTENT_GOLDENS) {
      const a = await renderResume(format, CANONICAL_DOC_FIXTURE);
      const b = await renderResume(format, CANONICAL_DOC_FIXTURE);
      expect(await extractArtifactText(format, a.body as Buffer)).toBe(
        await extractArtifactText(format, b.body as Buffer),
      );
    }
  });

  it('byte formats match their committed byte-golden', async () => {
    for (const { format, file } of BYTE_GOLDENS) {
      const out = await renderResume(format, CANONICAL_DOC_FIXTURE);
      const bytes = toBytes(out.body);
      const path = `${GOLDEN_DIR}${file}`;
      if (WRITE) {
        writeFileSync(path, bytes);
        continue;
      }
      expect(Buffer.compare(bytes, readFileSync(path)), `golden drift: ${file}`).toBe(0);
    }
  });

  it('content formats match their committed content-golden (extracted text)', async () => {
    for (const { format, file } of CONTENT_GOLDENS) {
      const out = await renderResume(format, CANONICAL_DOC_FIXTURE);
      const text = await extractArtifactText(format, out.body as Buffer);
      const path = `${GOLDEN_DIR}${file}`;
      if (WRITE) {
        writeFileSync(path, text, 'utf8');
        continue;
      }
      expect(text, `content golden drift: ${file}`).toBe(readFileSync(path, 'utf8'));
    }
  });
});
