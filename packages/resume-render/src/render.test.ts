import { describe, expect, it } from 'vitest';

import { type CanonicalResumeDoc } from '@careerforge/core';

import { PINNED_PDF_ID } from './constants.ts';
import { CANONICAL_DOC_FIXTURE } from './__fixtures__/canonical-doc.fixture.ts';
import { renderResume } from './render.ts';

const HOSTILE_CLAIM_TOKENS = ['caching', 'indexes', '40%', 'v2.0'];

describe('renderResume - artifacts + headers', () => {
  it('PDF renders a valid, id-pinned application/pdf buffer', async () => {
    const out = await renderResume('pdf', CANONICAL_DOC_FIXTURE);
    expect(Buffer.isBuffer(out.body)).toBe(true);
    const buf = out.body as Buffer;
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain(`/ID [<${PINNED_PDF_ID}>`);
    expect(out.contentType).toBe('application/pdf');
    expect(out.filename).toBe('jordan-rivera-resume.pdf');
  });

  it('DOCX renders a valid zip (PK) buffer', async () => {
    const out = await renderResume('docx', CANONICAL_DOC_FIXTURE);
    expect(Buffer.isBuffer(out.body)).toBe(true);
    expect((out.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    expect(out.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(out.filename).toBe('jordan-rivera-resume.docx');
  });

  it('markdown renders a string with the heading + right headers', async () => {
    const out = await renderResume('markdown', CANONICAL_DOC_FIXTURE);
    expect(typeof out.body).toBe('string');
    expect(out.body as string).toContain('# Jordan Rivera');
    expect(out.contentType).toBe('text/markdown; charset=utf-8');
    expect(out.filename).toBe('jordan-rivera-resume.md');
  });

  it('plaintext renders upper-cased section headings in the fixed order', async () => {
    const out = await renderResume('plaintext', CANONICAL_DOC_FIXTURE);
    const text = out.body as string;
    const order = ['SUMMARY', 'EXPERIENCE', 'PROJECTS', 'SKILLS', 'EDUCATION'].map((h) =>
      text.indexOf(h),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(out.filename).toBe('jordan-rivera-resume.txt');
  });

  it('json renders the canonical doc as stable, round-trippable data', async () => {
    const out = await renderResume('json', CANONICAL_DOC_FIXTURE);
    const parsed = JSON.parse(out.body as string) as CanonicalResumeDoc;
    expect(parsed.contact.fullName).toBe('Jordan Rivera');
    expect(parsed.claims).toHaveLength(CANONICAL_DOC_FIXTURE.claims.length);
    expect(out.contentType).toBe('application/json; charset=utf-8');
    // Stable serialization: identical string on re-render (byte determinism).
    const again = await renderResume('json', CANONICAL_DOC_FIXTURE);
    expect(again.body).toBe(out.body);
  });

  it('experience claims group under their entity subheadings, in fixed order', async () => {
    const text = (await renderResume('plaintext', CANONICAL_DOC_FIXTURE)).body as string;
    const acme = text.indexOf('Acme Corp - Senior Engineer');
    const globex = text.indexOf('Globex - Engineer');
    expect(acme).toBeGreaterThan(-1);
    expect(globex).toBeGreaterThan(acme);
  });

  it('filename falls back to the literal base `resume` when the slug is empty', async () => {
    const doc: CanonicalResumeDoc = {
      ...CANONICAL_DOC_FIXTURE,
      contact: { ...CANONICAL_DOC_FIXTURE.contact, fullName: '***' },
    };
    expect((await renderResume('pdf', doc)).filename).toBe('resume.pdf');
  });
});

describe('untrusted-text rendering law (D3): dynamic strings are literal, never markup', () => {
  it('markdown backslash-escapes the metacharacters in a hostile claim', async () => {
    const md = (await renderResume('markdown', CANONICAL_DOC_FIXTURE)).body as string;
    // The hostile claim: "Cut p95 latency by _40%_ via `caching` & [indexes](#) - shipped v2.0."
    expect(md).toContain('\\`caching\\`'); // code span neutralized
    expect(md).toContain('\\[indexes\\]\\(\\#\\)'); // link neutralized
    expect(md).toContain('\\_40%\\_'); // emphasis neutralized
    // No UNescaped code span / link / emphasis survives from the claim.
    expect(md).not.toContain('`caching`');
    expect(md).not.toContain('[indexes](#)');
  });

  it('every format contains the hostile claim tokens as literal text', async () => {
    for (const format of ['plaintext', 'json'] as const) {
      const text = (await renderResume(format, CANONICAL_DOC_FIXTURE)).body as string;
      for (const token of HOSTILE_CLAIM_TOKENS) expect(text).toContain(token);
    }
  });
});
