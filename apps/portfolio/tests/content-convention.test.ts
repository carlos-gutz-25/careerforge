// @vitest-environment node
//
// Text-parse gate (node env — do NOT copy the DOM docblock here, S1-3). The
// durable form of one-h1-per-document: the template owns the single <h1>, so
// content bodies start at <h2> ("## "). Any body-level "# " heading FAILs —
// this covers every future M2-05/06 doc before M2-03's axe gate exists.
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

// 1-indexed line numbers of any body-level `# ` (h1) heading, skipping the
// leading frontmatter block and fenced code.
function bodyH1Lines(text: string): number[] {
  const lines = text.split('\n');
  let inFrontmatter = false;
  let inFence = false;
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === '---') inFrontmatter = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#\s/.test(line)) hits.push(i + 1);
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
    it(`${rel}: no body-level "# " heading`, () => {
      const hits = bodyH1Lines(readFileSync(file, 'utf8'));
      expect(hits, `body "# " heading(s) at line(s) ${hits.join(', ')}`).toEqual([]);
    });
  }
});
