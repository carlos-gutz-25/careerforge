// Verifies the Lighthouse score artifact (.lighthouseci/manifest.json) is present
// and carries well-formed per-page scores before CI uploads it -- so the "CI
// numbers" the artifact promises (M8-17, cushion decisions) cannot silently rot.
// Browser-free, zero-dep, counts/urls only (no PII). Companion to the ci.yml
// upload step (portfolio-build). Runs AFTER `lighthouse budgets`, including on a
// floor-breach run: lhci autorun writes manifest.json in its `upload` step BEFORE
// it exits non-zero on the assertion failure (collect -> assert -> upload -> exit),
// so the numbers exist even when the gate fails -- the case they matter most.
//
// Gate-change law: its demonstrated FAIL lives in tests/lhci-artifact.test.ts
// (malformed / empty / no-home / missing manifests -> exit 1, on fictional data).
//
// Manifest entry shape (lhci filesystem upload target): each element carries
// `url` + `summary` = { performance, accessibility, best-practices, seo } as
// numbers in [0,1]. This gate fails the CI job if that shape ever stops holding.
//
// Usage: node apps/portfolio/scripts/assert-lhci-artifact.mjs [manifestPath]
//   manifestPath defaults to ../.lighthouseci/manifest.json next to this script;
//   the optional arg is used ONLY by the test / planted-FAIL demonstration.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];

function fail(msg) {
  process.stderr.write(`assert-lhci-artifact: FAIL - ${msg}\n`);
  process.exit(1);
}

const manifestPath =
  process.argv[2] ?? fileURLToPath(new URL('../.lighthouseci/manifest.json', import.meta.url));

let raw;
try {
  raw = readFileSync(manifestPath, 'utf8');
} catch {
  fail(`no lighthouse manifest at ${manifestPath} - did the lighthouse budgets step run?`);
}

let manifest;
try {
  manifest = JSON.parse(raw);
} catch (e) {
  fail(`manifest at ${manifestPath} is not valid JSON - ${e.message}`);
}

if (!Array.isArray(manifest) || manifest.length === 0) {
  fail('manifest is empty - no Lighthouse runs recorded');
}

for (const entry of manifest) {
  const url = entry && entry.url;
  const s = entry && entry.summary;
  if (!url || typeof url !== 'string') fail('manifest entry missing a url');
  if (!s || typeof s !== 'object') fail(`manifest entry ${url} missing summary scores`);
  for (const c of CATS) {
    const v = s[c];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      fail(`manifest entry ${url} has missing/invalid score '${c}' (${v})`);
    }
  }
}

const home = manifest.filter((e) => {
  try {
    return new URL(e.url).pathname === '/index.html';
  } catch {
    return false;
  }
});
if (home.length === 0) {
  fail('manifest has no home (/index.html) entry - coverage regressed');
}

const rep = home.find((e) => e.isRepresentativeRun) ?? home[0];
process.stdout.write(
  `assert-lhci-artifact: OK - ${manifest.length} entries, home perf ${rep.summary.performance}\n`,
);
