// Shared markdown-scanning helpers. Extracted VERBATIM from
// tests/content-convention.test.ts (its markdownFiles + bodyH1Lines) so two gates
// share ONE implementation of "what is a markdown file" and "what is a body-level
// h1": the content-convention vitest gate (the `test` job) and the case-study
// content gate (scripts/validate-case-studies.mjs, run in `portfolio-build`).
// Node-only, browser-free, zero deps. Logic is moved unchanged — the only edit is
// dropping the TypeScript annotations for this .mjs.
import { readdirSync, statSync } from 'node:fs';

// Recursively collect *.md files under `dir` (which must end in a separator, as
// the caller's trailing-slash URL and this function's own recursion both do).
export function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}${entry}`;
    if (statSync(full).isDirectory()) out.push(...markdownFiles(`${full}/`));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

// 1-indexed line numbers of any body-level h1 (ATX `# ` or SETEXT `=`
// underline), skipping the leading frontmatter block and fenced code.
export function bodyH1Lines(text) {
  const lines = text.split('\n');
  let inFrontmatter = false;
  let inFence = false;
  let frontmatterCloseIndex = -1;
  const hits = [];
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
