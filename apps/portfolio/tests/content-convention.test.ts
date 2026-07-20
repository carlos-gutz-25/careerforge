// @vitest-environment node
//
// Text-parse gate (node env — do NOT copy the DOM docblock here, S1-3). The
// durable form of one-h1-per-document: the template owns the single <h1>, so
// content bodies start at <h2> ("## "). Any body-level h1 FAILs — BOTH the ATX
// form ("# heading") AND the SETEXT form ("Title\n=====", which remark parses as
// an h1 and a "# " scan never sees, S3-1). This covers every future M2-05/06 doc
// before M2-03's axe gate exists.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const contentDir = fileURLToPath(new URL('../content/', import.meta.url));

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}${entry}`;
    if (statSync(full).isDirectory()) out.push(...markdownFiles(`${full}/`));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

// 1-indexed line numbers of any body-level h1 (ATX `# ` or SETEXT `=`
// underline), skipping the leading frontmatter block and fenced code.
function bodyH1Lines(text: string): number[] {
  const lines = text.split('\n');
  let inFrontmatter = false;
  let inFence = false;
  let frontmatterCloseIndex = -1;
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === '---') {
        inFrontmatter = false;
        frontmatterCloseIndex = i;
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // ATX h1: "# heading".
    if (/^#\s/.test(line)) {
      hits.push(i + 1);
      continue;
    }
    // SETEXT h1 (S3-1): a run of `=` underlining a non-blank, non-fence body
    // line. Setext h2 (the `-` underline) is an allowed body heading, not flagged.
    if (/^=+\s*$/.test(line) && i > 0) {
      const prev = lines[i - 1];
      const prevIsBodyContent =
        prev.trim() !== '' && !/^\s*```/.test(prev) && i - 1 !== frontmatterCloseIndex;
      if (prevIsBodyContent) hits.push(i + 1);
    }
  }
  return hits;
}

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
