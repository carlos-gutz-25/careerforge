#!/usr/bin/env node
// M5-01 retired-name gate.
//
// The personal project "Binventory" was renamed "Binnie" in v2 (V2-PLAN section 4).
// Forward-looking prose, code comments, and case-study CONTENT must use the
// new name. This gate fails the build if the retired name reappears anywhere
// in tracked content OUTSIDE a small history/slug allowlist, so a stray
// "Binventory" (a copy-paste, a new doc, a regenerated file) goes loudly RED
// instead of silently drifting back into the public site and repo.
//
// Content scan only: it reads each tracked file's bytes, never its path, so
// the deliberately-kept slug FILE (apps/portfolio/content/case-studies/
// binventory.md, URL /case-studies/binventory/ preserved) is not flagged for
// its name; that file is allowlisted for the one "formerly Binventory"
// provenance note its body carries.
//
// The allowlist is the append-only historical record (the BACKLOG ledger,
// ADR-0003's decision body, the RESOLVED OPEN-QUESTIONS Q3 heading) plus the
// kept slug file and this gate itself (which must name the retired token to
// match it). History is immutable; forward-looking docs were renamed.
//
// Verification-gate law (CLAUDE.md): any change to this gate ships a
// demonstrated planted-FAIL in the same change.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Anchor to the repo root so ALLOWLIST paths (repo-root-relative) and file
// reads are correct no matter which directory the gate is invoked from.
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const RETIRED = /binventory/i;

// Exact tracked paths permitted to contain the retired name.
const ALLOWLIST = new Set([
  'docs/BACKLOG.md', // append-only ledger history
  'docs/DECISIONS/0003-postgres-drizzle.md', // historical ADR decision body
  'docs/OPEN-QUESTIONS.md', // RESOLVED Q3 heading (history)
  'apps/portfolio/content/case-studies/binventory.md', // kept slug + "formerly Binventory" note
  'scripts/check-retired-names.mjs', // this gate names the retired token to match it
]);

// Newline-separated tracked paths, always relative to the repo root (ls-files
// is run with cwd: ROOT). This repo has no paths containing newlines, so a
// plain split is exact and avoids embedding a NUL delimiter in source.
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: ROOT })
    .split('\n')
    .filter(Boolean);
}

const offenders = [];
for (const path of trackedFiles()) {
  if (ALLOWLIST.has(path)) continue;
  let buf;
  try {
    buf = readFileSync(join(ROOT, path));
  } catch {
    continue; // unreadable - skip
  }
  if (buf.includes(0)) continue; // binary blob (NUL byte) - skip
  buf
    .toString('utf8')
    .split('\n')
    .forEach((line, i) => {
      if (RETIRED.test(line)) {
        offenders.push(`${path}:${i + 1}: ${line.trim()}`);
      }
    });
}

if (offenders.length > 0) {
  console.error(
    `retired-name gate: FAIL - found ${offenders.length} occurrence(s) of the retired name "Binventory" outside the history allowlist:`,
  );
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nFix: use "Binnie" in forward-looking content. Only append-only history (BACKLOG/ADR/resolved Q) and the kept slug file may carry the retired name - add the path to ALLOWLIST if that is genuinely what it is.',
  );
  process.exit(1);
}

console.log(
  `retired-name gate: clean - no "Binventory" in tracked content outside the ${ALLOWLIST.size} allowlisted history/slug path(s).`,
);
