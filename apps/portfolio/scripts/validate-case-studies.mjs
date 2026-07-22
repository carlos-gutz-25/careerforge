// Case-study content gate — the honesty schema enforcer for apps/portfolio.
//
// WHY THIS SCRIPT CARRIES 100% OF ENFORCEMENT (source-verified): @nuxt/content
// 3.15.0 performs NO schema validation at ingest — its `defineCollection` zod
// schema is converted to JSON Schema for column typing only, the parse path never
// calls safeParse, a missing required field inserts NULL and an out-of-enum value
// inserts verbatim. So `nuxt generate` builds GREEN on schema-violating content;
// content.config.ts's schema is typing + documentation. This deterministic,
// browser-free, dependency-free node script is the whole gate. See ADR-0010.
//
// NOT A YAML PARSER (honest limitation): frontmatter is read with a flat
// `key: value` scalar scan (content-convention style, no YAML dep). A GATE key
// (provenance/date/sensitivityReviewed) given a nested/multiline value fails R1
// loudly rather than being silently mis-read.
//
// COVERAGE BOUNDARY: this gate proves SHAPE and RESOLUTION, not TRUTH. It cannot
// verify a claim is true, that a cited file supports a number, or that
// docs/profile/projects.md contains a metric (that leg is local human review
// before merge — P-01 keeps that file out of the tree/CI forever). Story/risk
// citations are verified-lite (substring of BACKLOG/RISKS). Section semantics are
// unverified (headings exist/ordered/non-empty; whether "Tradeoffs" discusses
// tradeoffs is human review). No LLM touches any part of this.
//
// HOUSE GATE STYLE: collect all failures, print each, exit 0 clean / 1 violation
// / 2 cannot-run. Exit 2 is NEVER a pass. Run bare, never piped (pipefail law).
//
// Usage:
//   node apps/portfolio/scripts/validate-case-studies.mjs [target ...]
// Default target: <script-dir>/../content/case-studies/ (cwd-independent). An
// explicit target may be a file or a dir (recursive *.md). The path override is
// the P-01 escape hatch for the out-of-tree acceptance run.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { bodyH1Lines, markdownFiles } from './lib/markdown-scan.mjs';

// ── Canonical sections (R6) ──────────────────────────────────────────────────
// Case-insensitive; an optional numeric prefix, when present, must equal the
// section's 1-based position. §7 accepts "What I'd Change" / "What I Would
// Change" with an optional "…and What I Learned" tail.
export const SECTION_PATTERNS = [
  /^problem$/i,
  /^constraints$/i,
  /^architecture$/i,
  /^trade-?offs$/i,
  /^testing$/i,
  /^results$/i,
  /^what\s+i(?:['’]d|\s+would)\s+change(?:\s+and\s+\S.*)?$/i,
];
const SECTION_NAMES = [
  'problem',
  'constraints',
  'architecture',
  'tradeoffs',
  'testing',
  'results',
  "what-i'd-change",
];

const PROVENANCE_TOKENS = ['professional', 'personal', 'personal_ai_assisted'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function unquote(v) {
  const m = v.match(/^(['"])(.*)\1$/);
  return m ? m[2] : v;
}

// ── Frontmatter (R1) ─────────────────────────────────────────────────────────
// Flat scalar scan. Returns { ok, error, keys } where keys maps name →
// { value, line, hasBlock }. hasBlock marks a key whose value spilled into
// indented/list continuation lines (nested/multiline) — a gate key like that
// fails R1.
export function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { ok: false, error: 'no frontmatter block (file must start with `---`)', line: 1 };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return {
      ok: false,
      error: 'frontmatter block not closed (missing terminating `---`)',
      line: 1,
    };
  }
  const keys = new Map();
  let currentKey = null;
  for (let i = 1; i < close; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    // Continuation of a block value (indented, or a top-level list item).
    if (/^\s+/.test(raw) || /^-\s/.test(raw)) {
      if (currentKey) keys.get(currentKey).hasBlock = true;
      continue;
    }
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (!m) {
      return {
        ok: false,
        error: `frontmatter line ${i + 1} is not \`key: value\` (this is not a YAML parser)`,
        line: i + 1,
      };
    }
    currentKey = m[1];
    keys.set(currentKey, { value: m[2].trim(), line: i + 1, hasBlock: false });
  }
  return { ok: true, keys, closeLine: close + 1 };
}

// Fence-aware ATX headings in the body (after the frontmatter close). Returns
// { level, text, line } (1-indexed original line numbers).
function bodyHeadings(text, bodyStartIdx) {
  const lines = text.split('\n');
  const out = [];
  let inFence = false;
  for (let i = bodyStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  }
  return out;
}

// The raw body lines of a section: from just after its heading to just before the
// next level-2 heading (or EOF). Returns [{ text, line }].
function sectionLines(text, headings, index) {
  const lines = text.split('\n');
  const start = headings[index].line; // 1-indexed heading line
  const h2s = headings.filter((h) => h.level === 2);
  const self = headings[index];
  const nextH2 = h2s.find((h) => h.line > self.line);
  const end = nextH2 ? nextH2.line - 1 : lines.length; // 1-indexed inclusive
  const out = [];
  for (let ln = start + 1; ln <= end; ln++) out.push({ text: lines[ln - 1], line: ln });
  return out;
}

// Split section body into blocks: each list item is its own block; runs of
// non-blank, non-list lines are one paragraph block. Blank lines separate.
function splitBlocks(sectLines) {
  const blocks = [];
  let cur = null;
  let inFence = false;
  const flush = () => {
    if (cur && cur.text.trim() !== '') blocks.push(cur);
    cur = null;
  };
  for (const { text, line } of sectLines) {
    if (/^\s*```/.test(text)) {
      inFence = !inFence;
      if (cur) cur.text += `\n${text}`;
      else cur = { text, line };
      continue;
    }
    if (inFence) {
      if (cur) cur.text += `\n${text}`;
      else cur = { text, line };
      continue;
    }
    if (text.trim() === '') {
      flush();
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(text)) {
      flush();
      cur = { text, line };
    } else if (cur) {
      cur.text += `\n${text}`;
    } else {
      cur = { text, line };
    }
  }
  flush();
  return blocks;
}

// Citation spans `[...]` that are NOT markdown links `[label](url)`.
function citationsOf(text) {
  const out = [];
  const re = /\[([^\]]+)\](?!\()/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function stripForDigitCheck(text) {
  return text.replace(/`[^`]*`/g, '').replace(/\[[^\]]*\]/g, '');
}

// Verify ONE citation source string against the R8 grammar + resolvers.
// Returns { ok, isSha, reason }.
export function verifyCitationSource(src, { pathExists, shaResolves, backlogText, risksText }) {
  const s = src.trim();
  if (s === '') return { ok: false, isSha: false, reason: 'empty citation source' };

  // docs/profile/projects.md — special-cased first; opaque by P-01 (never in
  // tree/CI), so grammar-only, presence never checked.
  if (s === 'docs/profile/projects.md') return { ok: true, isSha: false };

  // git SHA (7–40 hex): must resolve to a commit.
  if (/^[0-9a-f]{7,40}$/.test(s)) {
    return shaResolves(s)
      ? { ok: true, isSha: true }
      : { ok: false, isSha: true, reason: `git SHA does not resolve: ${s}` };
  }

  // story/milestone token (M<major>[-<minor>][/<n>…]): verified-lite substring.
  if (/^M\d+(?:-\d+)?(?:\/\d+)*$/.test(s)) {
    return backlogText.includes(s)
      ? { ok: true, isSha: false }
      : { ok: false, isSha: false, reason: `milestone token not found in docs/BACKLOG.md: ${s}` };
  }

  // risk id (optional "RISKS " prefix): verified-lite substring of docs/RISKS.md.
  const riskMatch = s.match(/^(?:RISKS\s+)?([A-Z]-\d{2})$/);
  if (riskMatch) {
    return risksText.includes(riskMatch[1])
      ? { ok: true, isSha: false }
      : { ok: false, isSha: false, reason: `risk id not found in docs/RISKS.md: ${riskMatch[1]}` };
  }

  // repo path (optional :line[-line]): file must exist in tree. Two accepted
  // shapes — a path with a file extension, or an extensionless path containing
  // a separator.
  const hasExt = /^[A-Za-z0-9._/-]+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?$/.test(s);
  const extlessDir = /\//.test(s) && !/\s/.test(s) && /^[A-Za-z0-9._/-]+$/.test(s);
  if (hasExt || extlessDir) {
    const filePath = s.replace(/:\d+(?:-\d+)?$/, '');
    return pathExists(filePath)
      ? { ok: true, isSha: false }
      : { ok: false, isSha: false, reason: `cited repo path does not exist: ${filePath}` };
  }

  return {
    ok: false,
    isSha: false,
    reason: `unrecognized citation source (not a repo path, SHA, milestone, or risk id): "${s}"`,
  };
}

// ── The validator ────────────────────────────────────────────────────────────
// Returns { failures: [{ rule, line, message }], shaCitationsSeen }.
export function validateCaseStudy(text, opts) {
  const { filename, pathExists, shaResolves, backlogText, risksText } = opts;
  const failures = [];
  let shaCitationsSeen = 0;
  const fail = (rule, line, message) =>
    failures.push({ rule, line, message: `${filename}:${line}: ${rule}: ${message}` });

  // R1 — frontmatter present/closed; gate keys are flat scalars.
  const fm = parseFrontmatter(text);
  if (!fm.ok) {
    fail('R1', fm.line, fm.error);
    return { failures, shaCitationsSeen }; // nothing else parseable
  }
  for (const key of ['provenance', 'date', 'sensitivityReviewed']) {
    const k = fm.keys.get(key);
    if (k && k.hasBlock) {
      fail('R1', k.line, `gate key \`${key}\` is not a flat scalar (this is not a YAML parser)`);
    }
  }
  const bodyStartIdx = fm.closeLine; // 0-based index of first body line

  // R2 — provenance present and exactly one of the three storage tokens.
  const provEntry = fm.keys.get('provenance');
  const provenance = provEntry ? unquote(provEntry.value) : undefined;
  if (!provEntry || provenance === '') {
    fail('R2', provEntry?.line ?? 1, 'missing required `provenance` frontmatter key');
  } else if (!PROVENANCE_TOKENS.includes(provenance)) {
    fail(
      'R2',
      provEntry.line,
      `invalid provenance token "${provenance}" (must be one of ${PROVENANCE_TOKENS.join(', ')})`,
    );
  }

  // R3 — sensitivityReviewed required iff professional; date-format when present.
  const sr = fm.keys.get('sensitivityReviewed');
  if (provenance === 'professional' && (!sr || unquote(sr.value) === '')) {
    fail(
      'R3',
      provEntry?.line ?? 1,
      '`sensitivityReviewed` (YYYY-MM-DD) is required for professional provenance (RISKS L-02)',
    );
  }
  for (const key of ['date', 'sensitivityReviewed']) {
    const k = fm.keys.get(key);
    if (k && unquote(k.value) !== '' && !DATE_RE.test(unquote(k.value))) {
      fail('R3', k.line, `\`${key}\` must be YYYY-MM-DD, got "${unquote(k.value)}"`);
    }
  }

  // R4 — no body h1 (shared lib; skips frontmatter + fences itself).
  for (const line of bodyH1Lines(text)) {
    fail('R4', line, 'body-level h1 is not allowed (the template owns the single h1)');
  }

  // R5 — no prose Provenance line in the body (a surviving draft-migration line).
  const lines = text.split('\n');
  for (let i = bodyStartIdx; i < lines.length; i++) {
    if (/^\s*(\*\*)?provenance:/i.test(lines[i])) {
      fail(
        'R5',
        i + 1,
        'prose `Provenance:` line in the body — provenance belongs in frontmatter only',
      );
    }
  }

  // R6 — body ## headings are EXACTLY the seven canonical sections, in order.
  const headings = bodyHeadings(text, bodyStartIdx);
  const h2s = headings.filter((h) => h.level === 2);
  if (h2s.length !== 7) {
    fail(
      'R6',
      h2s[0]?.line ?? bodyStartIdx + 1,
      `expected exactly 7 \`##\` sections (${SECTION_NAMES.join(', ')}), found ${h2s.length}`,
    );
  }
  const matchedResultsIdx = []; // index into `headings` for a valid Results heading
  for (let i = 0; i < Math.min(h2s.length, 7); i++) {
    const h = h2s[i];
    const numMatch = h.text.match(/^(\d+)[.)]?\s+(.*)$/);
    const prefix = numMatch ? Number(numMatch[1]) : null;
    const name = numMatch ? numMatch[2].trim() : h.text.trim();
    if (prefix !== null && prefix !== i + 1) {
      fail(
        'R6',
        h.line,
        `section ${i + 1} has a numeric prefix "${prefix}" that does not match its position`,
      );
    }
    if (!SECTION_PATTERNS[i].test(name)) {
      fail('R6', h.line, `section ${i + 1} must be "${SECTION_NAMES[i]}", got "${h.text}"`);
    } else if (i === 5) {
      matchedResultsIdx.push(headings.indexOf(h));
    }
  }

  // R7 — every section non-empty (≥1 non-blank line before the next ##/EOF).
  for (let i = 0; i < Math.min(h2s.length, 7); i++) {
    const idx = headings.indexOf(h2s[i]);
    const body = sectionLines(text, headings, idx);
    const nonBlank = body.some((l) => l.text.trim() !== '');
    if (!nonBlank) fail('R7', h2s[i].line, `section "${h2s[i].text}" is empty`);
  }

  // R8 — Results sourcing (section 6 only).
  if (matchedResultsIdx.length === 1) {
    const resultsBody = sectionLines(text, headings, matchedResultsIdx[0]);
    const blocks = splitBlocks(resultsBody);
    for (const block of blocks) {
      const hasDigit = /\d/.test(stripForDigitCheck(block.text));
      const cites = citationsOf(block.text);
      if (hasDigit && cites.length === 0) {
        fail('R8', block.line, 'Results block states a number with no citation `[...]`');
      }
    }
    // EVERY citation in the section must parse + resolve.
    for (const block of blocks) {
      for (const cite of citationsOf(block.text)) {
        for (const src of cite.split(';')) {
          const trimmed = src.trim();
          if (trimmed === '') continue;
          const v = verifyCitationSource(trimmed, {
            pathExists,
            shaResolves,
            backlogText,
            risksText,
          });
          if (v.isSha) shaCitationsSeen += 1;
          if (!v.ok) fail('R8', block.line, v.reason);
        }
      }
    }
  }

  return { failures, shaCitationsSeen };
}

// ── CLI (real resolvers) ─────────────────────────────────────────────────────
function gitTop() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : process.cwd();
}
function isShallow() {
  const r = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

function collectFiles(targets, defaultDir) {
  // Returns { files, exitTwo, note }. Explicit-target rules differ from default.
  if (targets.length === 0) {
    if (!existsSync(defaultDir)) {
      return {
        files: [],
        note: `no case-study content yet (${defaultDir} absent) — M2-04 ships the mechanism before content`,
      };
    }
    const files = markdownFiles(defaultDir.endsWith('/') ? defaultDir : `${defaultDir}/`);
    if (files.length === 0) {
      return { files: [], note: `no case-study markdown files under ${defaultDir}` };
    }
    return { files };
  }
  const files = [];
  for (const t of targets) {
    if (!existsSync(t)) return { files: [], exitTwo: `explicit target does not exist: ${t}` };
    if (statSync(t).isDirectory()) {
      const found = markdownFiles(t.endsWith('/') ? t : `${t}/`);
      if (found.length === 0)
        return { files: [], exitTwo: `explicit target directory has no *.md files: ${t}` };
      files.push(...found);
    } else {
      files.push(t);
    }
  }
  return { files };
}

function main() {
  const defaultDir = fileURLToPath(new URL('../content/case-studies/', import.meta.url));
  const targets = process.argv.slice(2);

  const { files, exitTwo, note } = collectFiles(targets, defaultDir);
  if (exitTwo) {
    console.error(`validate-case-studies: cannot run — ${exitTwo}`);
    process.exit(2);
  }
  if (files.length === 0) {
    console.log(`validate-case-studies: ${note}`);
    process.exit(0);
  }

  const root = gitTop();
  const readOrEmpty = (rel) => {
    const p = `${root}/${rel}`;
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };
  const resolvers = {
    pathExists: (rel) => existsSync(`${root}/${rel}`),
    shaResolves: (sha) =>
      spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root }).status === 0,
    backlogText: readOrEmpty('docs/BACKLOG.md'),
    risksText: readOrEmpty('docs/RISKS.md'),
  };

  const allFailures = [];
  let shaCitationsSeen = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    const { failures, shaCitationsSeen: seen } = validateCaseStudy(text, {
      filename: rel,
      ...resolvers,
    });
    allFailures.push(...failures);
    shaCitationsSeen += seen;
  }

  // Shallow-checkout guard: SHA citations cannot be verified on a shallow clone.
  // Removing CI's `fetch-depth: 0` therefore goes loudly RED (exit 2), never
  // silently ungated.
  if (shaCitationsSeen > 0 && isShallow()) {
    console.error(
      'validate-case-studies: cannot verify SHA citations on a shallow checkout — set `fetch-depth: 0`',
    );
    process.exit(2);
  }

  if (allFailures.length > 0) {
    console.error(
      `validate-case-studies: ${allFailures.length} failure(s) across ${files.length} file(s):`,
    );
    for (const f of allFailures) console.error(`  ✘ ${f.message}`);
    process.exit(1);
  }

  console.log(
    `validate-case-studies: OK — ${files.length} case study/studies pass the honesty schema`,
  );
  process.exit(0);
}

// Run as CLI only (not when imported by vitest).
if (import.meta.url === `file://${process.argv[1]}`) main();
