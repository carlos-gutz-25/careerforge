// Privacy gate, content leg (RISKS P-01): verify no string from the real,
// gitignored docs/profile/ appears in the COMMITTED branch diff
// (git diff <base>...HEAD, base = origin's default branch, main fallback).
// Reads real files locally but prints ONLY masked tokens (first 2 chars +
// length) and match counts — never values.
//
// Run AFTER committing, BEFORE pushing, on any branch that touched
// profile-adjacent code: `node scripts/privacy-check.mjs`. Uncommitted
// changes are invisible to it — commit first or the check proves nothing.
//
// Exit codes: 0 = clean · 1 = leak found · 2 = cannot run (no real profile —
// e.g. CI or a fresh clone; "cannot verify" is never reported as a pass).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional argv override so the fail-safe path is testable without touching
// the real profile directory.
const repoRoot = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
const profileDir = path.join(repoRoot, 'docs', 'profile');

const profileFiles = existsSync(profileDir)
  ? readdirSync(profileDir).filter((f) => f.endsWith('.md'))
  : [];
if (profileFiles.length === 0) {
  process.stderr.write(
    `SKIPPED: no real profile markdown at ${path.join('docs', 'profile')} — ` +
      'this gate verifies REAL career data and cannot run without it (CI/fresh clones). ' +
      'Not a pass.\n',
  );
  process.exit(2);
}

// Base = origin's default branch, so a default-branch rename can't silently
// break the gate; fall back to main when origin/HEAD isn't set locally.
let baseBranch = 'main';
try {
  baseBranch =
    execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: repoRoot, stdio: 'pipe' })
      .toString()
      .trim()
      .replace(/^refs\/remotes\/origin\//, '') || 'main';
} catch {
  // No origin/HEAD ref (fresh remote, scratch repo) — main fallback stands.
}

// Only lines the branch ADDS are exposure candidates: deleted and context
// lines are base-branch content, already public. Scanning the raw diff text
// produced a false positive (2026-07-14, M0-09): a public dependency name in
// a lockfile CONTEXT line next to genuinely added lines collided with a real
// skills.md cell (which name stays out of this comment for the same reason
// this script masks its output). A real-profile string sitting in a context
// line would mean it was already published by an earlier change — a
// pre-existing incident, not something a per-branch gate can catch.
//
// pnpm-lock.yaml is excluded entirely (2026-07-15, M0-10): the SAME collision
// class recurred in ADDED lockfile lines — short real-skill cells matching as
// substrings inside public npm package names the branch legitimately pulls
// in. Lockfile content is derived from the public registry by construction
// (package identifiers, hashes, version graphs); private profile data cannot
// enter it through dependency resolution, and gitleaks + the tracked-file
// guard still scan it structurally. Proven by scratch-repo probe before
// adopting: a token in an added lockfile line no longer fails, while the
// same token in any other added line still exits 1 — no detection lost for
// content a human authors.
// ('+++' is the file-name header, not content.)
const EXCLUDED_FILES = new Set(['pnpm-lock.yaml']);
const rawDiff = execSync(`git diff ${baseBranch}...HEAD`, {
  cwd: repoRoot,
  maxBuffer: 64 * 1024 * 1024,
}).toString();
const addedLines = [];
let currentFile = '';
for (const line of rawDiff.split('\n')) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice('+++ b/'.length);
    continue;
  }
  if (line.startsWith('+') && !line.startsWith('+++') && !EXCLUDED_FILES.has(currentFile)) {
    addedLines.push(line);
  }
}
const diff = addedLines.join('\n').toLowerCase();

const tokens = new Set();
// P-01's most sensitive classes live in plain prose / link targets that the
// structural extractors never capture, and a leak may be formatted differently
// than the source — so phones are also probed digits-only against a
// digits-only diff, and salary figures comma-stripped against a
// comma-stripped diff.
const phoneDigitProbes = new Set();
const salaryProbes = new Set();
for (const file of profileFiles) {
  const content = readFileSync(path.join(profileDir, file), 'utf8');
  for (const [re, group] of [
    [/[\w.+-]+@[\w-]+\.[\w.]+/g, 0], // emails
    [/https?:\/\/[^\s)>\]]+/g, 0], // URLs
    [/\*\*([^*\n]{3,})\*\*/g, 1], // bold spans (companies, field labels stripped below)
    [/^#{1,3}\s+(.+)$/gm, 1], // headings (name, titles, project names)
    [/^\|([^|\n]{3,})\|/gm, 1], // first table cells (skill names)
  ]) {
    for (const m of content.matchAll(re)) {
      const raw = (m[group] ?? '').trim().replace(/[:*]+$/, '');
      if (raw.length >= 3) tokens.add(raw.toLowerCase());
    }
  }
  // Phone numbers: tel: URIs and phone-shaped literals in any position.
  for (const re of [/tel:\+?[\d-]+/g, /\b\+?1?[-.\s(]*\d{3}[-.)\s]*\d{3}[-.\s]*\d{4}\b/g]) {
    for (const m of content.matchAll(re)) {
      const raw = m[0].trim();
      tokens.add(raw.toLowerCase());
      const digits = raw.replace(/\D/g, '');
      if (digits.length >= 7) phoneDigitProbes.add(digits);
    }
  }
  // Salary figures: currency amounts in plain prose (labels are bold and
  // structural-allowlisted; the numbers themselves are not).
  for (const m of content.matchAll(/\$\s?\d{2,3}(?:,\d{3})+(?:\+)?/g)) {
    const raw = m[0].trim();
    tokens.add(raw.toLowerCase());
    salaryProbes.add(raw.replace(/,/g, ''));
  }
}

// Field labels and structural words shared with the example format are not
// secrets — they SHOULD appear in the diff.
const structural = new Set([
  'company',
  'role',
  'period',
  'provenance',
  'skill',
  'category',
  'level',
  'years',
  'last used',
  'skills',
  'education',
  'contributions',
  'impact',
  'technologies',
  'professional experience',
  'professional summary',
  'github profile',
  'inspection priority',
  'github repositories claude may inspect',
  'professional projects without repository links',
]);

// Anything already published in the fictional example profile (which
// deliberately mirrors the real structure: shared headings, generic titles,
// separators) is public by design — a "leak" is a string that exists ONLY in
// the real profile yet shows up in the diff.
let publicCorpus = '';
const exampleDir = path.join(repoRoot, 'docs', 'profile.example');
for (const file of readdirSync(exampleDir).filter((f) => f.endsWith('.md'))) {
  publicCorpus += readFileSync(path.join(exampleDir, file), 'utf8').toLowerCase();
}

// Distinctiveness (2026-07-15, M1-01 — the parked matching-semantics fix,
// trigger fired): a token that already occurs in the BASE BRANCH's committed
// content is part of the repo's public vocabulary and reveals nothing when a
// branch writes it again (the third false-positive class: a real-profile
// heading that is a common English word matched ordinary prose in a ledger).
// Same logic as added-lines-only: base content is already public, and a real
// token already sitting in it would be a pre-existing incident outside a
// per-branch gate's scope. Genuinely private strings — contact info, salary
// figures, unpublished names — cannot be in the base tree, so no detection
// is lost for anything this gate exists to catch. `git grep '' <base>`
// streams every text line of the base tree; -I excludes binary files
// entirely (M1-02) — without it they contribute "Binary file <path> matches"
// lines, letting file PATHS enter the subtraction corpus (probe-proven:
// a binary whose name contained a planted token self-blinded the gate).
let baseCorpus = '';
try {
  baseCorpus = execSync(`git grep -h -I --textconv "" ${baseBranch}`, {
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .toLowerCase();
} catch {
  // A base with zero grep-able lines is implausible; treat failure as "no
  // subtraction" (stricter, never looser).
}
publicCorpus += baseCorpus;

const mask = (t) => `${t.slice(0, 2)}…(${t.length})`;
let leaks = 0;
let checked = 0;
for (const token of tokens) {
  if (structural.has(token) || token.length < 4) continue;
  if (publicCorpus.includes(token)) continue;
  checked += 1;
  if (diff.includes(token)) {
    leaks += 1;
    process.stdout.write(`LEAK ${mask(token)}\n`);
  }
}

// Normalized probes: each class is compared in the same normalization on both
// sides, so formatting differences between source and leak still match. The
// example-corpus subtraction applies in the same normalized space.
const normalizedPasses = [
  { probes: phoneDigitProbes, normalize: (s) => s.replace(/\D/g, ''), label: 'phone digits' },
  { probes: salaryProbes, normalize: (s) => s.replace(/,/g, ''), label: 'salary' },
];
for (const { probes, normalize, label } of normalizedPasses) {
  const normalizedDiff = normalize(diff);
  const normalizedCorpus = normalize(publicCorpus);
  for (const probe of probes) {
    if (normalizedCorpus.includes(probe)) continue;
    checked += 1;
    if (normalizedDiff.includes(probe)) {
      leaks += 1;
      process.stdout.write(`LEAK ${mask(probe)} (${label}, normalized)\n`);
    }
  }
}
process.stdout.write(`checked ${checked} distinctive real-profile tokens against the diff\n`);
process.stdout.write(
  leaks === 0 ? 'PASS: zero real-profile strings in the diff\n' : `FAIL: ${leaks} leaks\n`,
);
process.exit(leaks === 0 ? 0 : 1);
