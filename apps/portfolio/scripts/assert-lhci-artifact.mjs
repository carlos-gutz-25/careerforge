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
// numbers in [0,1], and THREE entries per URL (`numberOfRuns: 3`), the median
// flagged `isRepresentativeRun`. This gate fails the CI job if that shape ever
// stops holding.
//
// M16-05 (ADR-0016 ramp observability): after the shape checks this script also
// prints a per-page cushion report against the 0.96 abort-to-system-stack ramp.
// The ramp is a WARNING, NEVER an error -- ADR-0016 keeps the CI floor at 0.95
// and puts the ramp above it "so the typeface is sacrificed before the budget is
// ever at risk", so making 96 blocking would redefine a ratified decision. The
// report path therefore never alters the exit code. The ONE exception is a
// PRECONDITION failure: a scope read that resolves to nothing means the report
// never ran at all, and that exits non-zero (see EMPTY SCOPE below).
//
// Usage: node apps/portfolio/scripts/assert-lhci-artifact.mjs [manifestPath] [lighthousercPath]
//   manifestPath defaults to ../.lighthouseci/manifest.json next to this script;
//   lighthousercPath defaults to ../lighthouserc.cjs next to this script;
//   both optional args are used ONLY by the test / planted-FAIL demonstration.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];

// ADR-0016:107-112 - "If the median performance score drops below 96, the
// Fraunces display face is DROPPED back to the system stack." Compared against
// the RAW manifest float (Lighthouse clamps category scores to two decimals in
// core/scoring.js before @lhci/cli copies them verbatim into the manifest, so
// raw and the rounded 0-100 idiom cannot disagree on any emittable value).
// "drops BELOW 96" - exactly 0.96 does NOT fire.
const RAMP = 0.96;

function fail(msg) {
  process.stderr.write(`assert-lhci-artifact: FAIL - ${msg}\n`);
  process.exit(1);
}

const manifestPath =
  process.argv[2] ?? fileURLToPath(new URL('../.lighthouseci/manifest.json', import.meta.url));
// resolve()d against the cwd: createRequire resolves a bare relative specifier
// against THIS file, so an unresolved './x.cjs' argument would report a
// module-not-found instead of the config read it was pointed at.
const lighthousercPath = process.argv[3]
  ? resolve(process.argv[3])
  : fileURLToPath(new URL('../lighthouserc.cjs', import.meta.url));

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

// ---------------------------------------------------------------------------
// M16-05: the ADR-0016 ramp cushion report.
// ---------------------------------------------------------------------------
// SCOPE IS READ FROM lighthouserc.cjs, NEVER RETYPED. The asserted-page set is
// a fact that config owns; a second copy here would let the floor's scope and
// the report's scope drift apart silently, and the report would start
// describing a different page set than the gate. `require` is invalid in ESM,
// hence createRequire.
let scopePatterns = [];
try {
  const rc = createRequire(import.meta.url)(lighthousercPath);
  const matrix = rc && rc.ci && rc.ci.assert && rc.ci.assert.assertMatrix;
  scopePatterns = (Array.isArray(matrix) ? matrix : [])
    .map((m) => m && m.matchingUrlPattern)
    .filter((p) => typeof p === 'string' && p.length > 0)
    .map((p) => new RegExp(p));
} catch (e) {
  fail(`could not read the asserted-page scope from ${lighthousercPath} - ${e.message}`);
}

// The Nuxt SPA fallbacks (200.html / 404.html) are collected but not asserted,
// so they get NO row and NO warning - they are filtered out before the report
// is built, never printed-and-skipped.
const scoped = manifest.filter((e) => scopePatterns.some((re) => re.test(e.url)));

// EMPTY SCOPE = A BROKEN READ, NEVER A CLEAN TREE (the fail-open this report
// would otherwise ship with). A renamed key or a restructured assertMatrix
// resolves to nothing, the table prints with no rows, no warning can fire for
// any page, and the ramp observability is silently switched off - possibly
// forever, because nothing is red and nothing is missing. This is a PRECONDITION
// failure: the report never ran, so it is outside the "never alter the exit
// code" rule that governs the report path below.
if (scopePatterns.length === 0 || scoped.length === 0) {
  fail(
    `asserted-page scope is EMPTY - ${scopePatterns.length} matchingUrlPattern(s) read from ` +
      `${lighthousercPath} matched ${scoped.length} of ${manifest.length} manifest entries. ` +
      'An empty scope is a broken config read, never a clean tree.',
  );
}

// The manifest carries one entry PER RUN (numberOfRuns: 3), and the median is
// the one flagged isRepresentativeRun. Selecting per URL with the same
// `?? entries[0]` fallback the home readout above already uses, so this script
// speaks one idiom rather than two.
const byUrl = new Map();
for (const e of scoped) {
  if (!byUrl.has(e.url)) byUrl.set(e.url, []);
  byUrl.get(e.url).push(e);
}

// Decimal places of a score as written. toFixed(10) rather than String() so an
// exponential form (1e-7) and float noise cannot masquerade as a clamp value.
function decimalPlaces(v) {
  const s = v.toFixed(10).replace(/0+$/, '');
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

// The 0-100 rendering Lighthouse itself shows. Printed BESIDE the raw value,
// never instead of it: the board reads these numbers in two idioms, and a line
// carrying only one makes every reader do the conversion.
function displays(v) {
  return Math.round(v * 100);
}

const rows = [...byUrl].map(([url, entries]) => {
  const median = entries.find((e) => e.isRepresentativeRun) ?? entries[0];
  const perf = median.summary.performance;
  return { url, perf, runs: entries.length, dp: decimalPlaces(perf) };
});

// THE TABLE PRINTS ON EVERY RUN, INCLUDING CLEAN ONES. The failure this report
// exists to fix is a number nobody sees; a report that appears only when
// something is wrong recreates it one notch up, and an author who lands at 96.2
// learns nothing about how close they came. Pass-run output is the feature.
const w = Math.max(3, ...rows.map((r) => r.url.length));
process.stdout.write(
  `assert-lhci-artifact: ADR-0016 ramp cushion report - ramp ${RAMP} raw (${displays(RAMP)} displayed), CI floor 0.95\n`,
);
process.stdout.write(`  ${'URL'.padEnd(w)}  PERF    DISPLAYS  CUSHION  RUNS  DP\n`);
for (const r of rows) {
  const cushion = r.perf - RAMP;
  const signed = (cushion >= 0 ? '+' : '') + cushion.toFixed(3);
  const cells = [
    r.url.padEnd(w),
    String(r.perf).padEnd(6),
    String(displays(r.perf)).padEnd(8),
    signed.padEnd(7),
    String(r.runs).padEnd(4),
    String(r.dp),
  ];
  process.stdout.write(`  ${cells.join('  ')}\n`);
}

// A ramp breach is the report WORKING, not the gate failing: warn on stdout and
// exit 0. stderr in this file means the gate failed (the fail() path above), and
// dressing a warning as a failure would mislead every log reader and every
// future grep.
for (const r of rows) {
  if (r.perf < RAMP) {
    process.stdout.write(
      `RAMP WARNING: ${r.url} performance ${r.perf} (displays ${displays(r.perf)}) ` +
        `is below the ADR-0016 ramp (${RAMP} raw)\n`,
    );
  }
}

// >2dp TRIPWIRE, INSTRUMENTED rather than eyeballed. The raw-vs-rounded choice
// is safe ONLY because Lighthouse clamps to two decimals; if that chain ever
// changes upstream the two conventions genuinely diverge and the ruling becomes
// load-bearing. Loud, and deliberately NOT a failure - it is a routing signal,
// and the report path may not alter the exit code.
for (const r of rows) {
  if (r.dp > 2) {
    process.stdout.write(
      `RAMP PRECISION: ${r.url} performance ${r.perf} carries ${r.dp} decimals - Lighthouse ` +
        'clamps category scores to 2. STOP and route: the raw-vs-rounded equivalence no longer holds.\n',
    );
  }
}
