// @vitest-environment node
//
// Text-parse gate (node env — do NOT copy the DOM docblock here, S1-3). The
// durable form of one-h1-per-document: the template owns the single <h1>, so
// content bodies start at <h2> ("## "). Any body-level h1 FAILs — BOTH the ATX
// form ("# heading") AND the SETEXT form ("Title\n=====", which remark parses as
// an h1 and a "# " scan never sees, S3-1). This covers every future M2-05/06 doc
// before M2-03's axe gate exists.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// markdownFiles + bodyH1Lines moved to the shared lib (verbatim) so the
// case-study content gate reuses the SAME body-h1 detector — see
// scripts/lib/markdown-scan.mjs. The describe/it assertions below are unchanged.
import { bodyH1Lines, markdownFiles } from '../scripts/lib/markdown-scan.mjs';

const contentDir = fileURLToPath(new URL('../content/', import.meta.url));

describe('content convention — no h1 in markdown bodies (template owns the h1)', () => {
  const files = markdownFiles(contentDir);

  it('finds at least one content file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.slice(contentDir.length);
    it(`${rel}: no body-level h1 (ATX or setext)`, () => {
      const hits = bodyH1Lines(readFileSync(file, 'utf8'));
      expect(hits, `body h1 (atx/setext) at line(s) ${hits.join(', ')}`).toEqual([]);
    });
  }
});
