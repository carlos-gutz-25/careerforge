// @vitest-environment node
//
// M8-17 gate test + demonstrated planted-FAIL (gate-change law). Runs the real
// scripts/assert-lhci-artifact.mjs as a subprocess against FICTIONAL manifest
// fixtures written to the OS temp dir (never .lighthouseci, never committed) and
// pins its exit code. This is BOTH the forward regression guard (a future change
// that stops the gate rejecting a bad manifest goes red) AND the permanent
// demonstrated detection on planted data required for a gate-touching change:
//   - well-formed manifest        -> exit 0
//   - a summary missing a score   -> exit 1  (planted FAIL A)
//   - empty array                 -> exit 1  (planted FAIL B)
//   - no home (/index.html) entry -> exit 1  (planted FAIL C)
//   - missing manifest file       -> exit 1  (planted FAIL D)
// Subprocess (not import) so we exercise the CLI's process.exit contract exactly
// as CI does.
//
// M16-05 adds the ADR-0016 ramp cushion report and FOUR new assertions, each
// with its own appliable mutation in the PR body (ramp operator, URL filter,
// display idiom, non-empty-scope guard):
//   - the ramp comparison is strictly-below 0.96, warns, and NEVER fails
//   - the reported scope is read from lighthouserc.cjs, not retyped
//   - the warning line carries BOTH idioms (raw float + 0-100 rendering)
//   - an empty resolved scope is a loud RED, never an empty table and exit 0
// The value cases below are the boundary the instrument can actually produce
// (0.95 / 0.96), plus 0.955 as an explicitly unreachable-today guard.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/assert-lhci-artifact.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'lhci-artifact-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Run the gate against a manifest path; return its exit code (0 on success, the
// process exit status on failure). execFileSync throws on a non-zero exit.
function runGate(manifestPath: string): number {
  try {
    execFileSync('node', [script, manifestPath], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

// Run the gate and return its exit code AND its streams -- the ramp report is
// OUTPUT, so an exit code alone cannot tell a correct report from a blank one.
function runReport(
  manifestPath: string,
  rcPath?: string,
): { status: number; stdout: string; stderr: string } {
  const args = rcPath ? [script, manifestPath, rcPath] : [script, manifestPath];
  try {
    const stdout = execFileSync('node', args, { stdio: 'pipe', encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// Write a fixture manifest and return its path.
function fixture(name: string, data: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(data), 'utf8');
  return p;
}

// Write a fictional lighthouserc CJS fixture and return its path.
function rcFixture(name: string, source: string): string {
  const p = join(dir, name);
  writeFileSync(p, source, 'utf8');
  return p;
}

// Table rows are `  <url>  <perf>  ...`; the RAMP WARNING lines are not indented,
// so this counts ROWS and never a warning mentioning the same URL.
function rowsFor(stdout: string, url: string): string[] {
  return stdout.split('\n').filter((l) => l.startsWith(`  ${url} `));
}

const goodSummary = { performance: 0.98, accessibility: 1, 'best-practices': 1, seo: 1 };
const wellFormed = [
  { url: 'http://localhost:1/index.html', isRepresentativeRun: true, summary: goodSummary },
  { url: 'http://localhost:1/about/index.html', isRepresentativeRun: true, summary: goodSummary },
];

describe('assert-lhci-artifact gate', () => {
  it('passes on a well-formed manifest with home coverage', () => {
    expect(runGate(fixture('good.json', wellFormed))).toBe(0);
  });

  it('FAILS when an entry summary is missing a category score (planted FAIL A)', () => {
    const bad = [
      {
        url: 'http://localhost:1/index.html',
        summary: { accessibility: 1, 'best-practices': 1, seo: 1 }, // no performance
      },
    ];
    expect(runGate(fixture('missing-score.json', bad))).toBe(1);
  });

  it('FAILS on an empty manifest array (planted FAIL B)', () => {
    expect(runGate(fixture('empty.json', []))).toBe(1);
  });

  it('FAILS when no home (/index.html) entry is present (planted FAIL C)', () => {
    const noHome = [
      {
        url: 'http://localhost:1/about/index.html',
        isRepresentativeRun: true,
        summary: goodSummary,
      },
    ];
    expect(runGate(fixture('no-home.json', noHome))).toBe(1);
  });

  it('FAILS when the manifest file is missing (planted FAIL D)', () => {
    expect(runGate(join(dir, 'does-not-exist.json'))).toBe(1);
  });

  it('FAILS when a score is out of the [0,1] range', () => {
    const bad = [
      { url: 'http://localhost:1/index.html', summary: { ...goodSummary, performance: 1.5 } },
    ];
    expect(runGate(fixture('out-of-range.json', bad))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// M16-05 - the ADR-0016 ramp cushion report.
// ---------------------------------------------------------------------------
const HOME = 'http://localhost:1/index.html';
const STUDY = 'http://localhost:1/case-studies/fictional-study/index.html';
// COLLECTED BUT NOT ASSERTED. Its presence is a binding precondition, not
// decoration: without a non-matching URL in the fixture, deleting the script's
// URL filter would change no output and the mutation could not go red.
const FALLBACK = 'http://localhost:1/200.html';

function ramp(name: string, homePerf: number): string {
  return fixture(name, [
    { url: HOME, isRepresentativeRun: true, summary: { ...goodSummary, performance: homePerf } },
    { url: STUDY, isRepresentativeRun: true, summary: goodSummary },
    { url: FALLBACK, isRepresentativeRun: true, summary: goodSummary },
  ]);
}

function warningLine(url: string, perf: number, shown: number): string {
  return `RAMP WARNING: ${url} performance ${perf} (displays ${shown}) is below the ADR-0016 ramp (0.96 raw)`;
}

describe('ADR-0016 ramp cushion report', () => {
  // "drops below 96" - 0.95 fires and 0.96 does not. That adjacent pair is the
  // only boundary Lighthouse's 2-decimal clamp can actually produce, and it is
  // the exact point the ramp ruling already had to correct once in the record.
  it.each([
    [0.94, 94, true],
    [0.95, 95, true],
    [0.96, 96, false],
    [0.97, 97, false],
  ])('perf %s (displays %s) -> warning fired: %s, exit 0 either way', (perf, shown, fires) => {
    const r = runReport(ramp(`ramp-${perf}.json`, perf as number));
    expect(r.status).toBe(0);
    if (fires) {
      expect(r.stdout).toContain(warningLine(HOME, perf as number, shown as number));
    } else {
      expect(r.stdout).not.toContain(`RAMP WARNING: ${HOME}`);
    }
  });

  // UNREACHABLE TODAY: Lighthouse clamps category scores to two decimals, so no
  // real run can emit 0.955. It is here to PIN the behaviour, so that if that
  // clamp ever changes upstream the suite fails loudly instead of the raw and
  // rounded conventions silently parting company.
  //
  // AND THIS IS THE ONE LINE WHERE THEY PART: it warns (raw, 0.955 < 0.96)
  // while DISPLAYING 96, which under the rounded convention would be silent.
  // Carrying both idioms is what makes that contradiction visible to a reader
  // instead of leaving it to be discovered by whoever disagrees with the gate.
  it('perf 0.955 fires under the raw rule and trips the >2dp tripwire (unreachable today)', () => {
    const r = runReport(ramp('ramp-0.955.json', 0.955));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(warningLine(HOME, 0.955, 96));
    expect(r.stdout).toContain(`RAMP PRECISION: ${HOME} performance 0.955 carries 3 decimals`);
  });

  it('prints the table on a CLEAN run, with no warning (pass-run output is the feature)', () => {
    const r = runReport(ramp('ramp-clean.json', 0.98));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ADR-0016 ramp cushion report');
    expect(rowsFor(r.stdout, HOME)).toHaveLength(1);
    expect(rowsFor(r.stdout, STUDY)).toHaveLength(1);
    expect(r.stdout).not.toContain('RAMP WARNING');
    expect(r.stdout).not.toContain('RAMP PRECISION');
  });

  it('scopes to the asserted pages: 200.html gets NO row and NO warning', () => {
    const r = runReport(ramp('ramp-scope.json', 0.94));
    expect(r.status).toBe(0);
    expect(rowsFor(r.stdout, FALLBACK)).toHaveLength(0);
    expect(r.stdout).not.toContain(`RAMP WARNING: ${FALLBACK}`);
    // ...while the asserted pages ARE reported, so the assertion above is about
    // the filter and not about an empty report.
    expect(rowsFor(r.stdout, HOME)).toHaveLength(1);
    expect(rowsFor(r.stdout, STUDY)).toHaveLength(1);
  });

  // numberOfRuns: 3 means THREE entries per URL. An implementation that printed
  // one row per ENTRY, or that took run 1, would pass every single-entry fixture
  // above; only this leg tells a median-blind implementation from a correct one.
  it('selects the isRepresentativeRun median per URL, one row per page', () => {
    const s = (performance: number) => ({ ...goodSummary, performance });
    const multi = fixture('ramp-multirun.json', [
      { url: HOME, isRepresentativeRun: false, summary: s(0.99) },
      { url: HOME, isRepresentativeRun: true, summary: s(0.94) },
      { url: HOME, isRepresentativeRun: false, summary: s(0.99) },
      { url: STUDY, isRepresentativeRun: false, summary: s(0.98) },
      { url: STUDY, isRepresentativeRun: true, summary: s(0.98) },
      { url: STUDY, isRepresentativeRun: false, summary: s(0.98) },
      { url: FALLBACK, isRepresentativeRun: true, summary: s(0.98) },
    ]);
    const r = runReport(multi);
    expect(r.status).toBe(0);
    const home = rowsFor(r.stdout, HOME);
    expect(home).toHaveLength(1);
    expect(home[0]).toContain('0.94');
    expect(home[0]).not.toContain('0.99');
    expect(home[0]).toMatch(/\s3\s/); // RUNS column: three runs collapsed to one row
    expect(r.stdout).toContain(warningLine(HOME, 0.94, 94));
    // The non-representative 0.99 runs must not produce warnings or rows of
    // their own; the whole report is exactly two rows.
    expect(rowsFor(r.stdout, STUDY)).toHaveLength(1);
  });

  it('FAILS LOUDLY when the config read resolves no assertMatrix (planted FAIL E)', () => {
    const rc = rcFixture(
      'rc-renamed-key.cjs',
      "module.exports = { ci: { assert: { assertMatrixRENAMED: [ { matchingUrlPattern: '.*/index\\\\.html$' } ] } } };\n",
    );
    const r = runReport(ramp('ramp-emptyscope.json', 0.98), rc);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('asserted-page scope is EMPTY');
    expect(r.stderr).toContain('0 matchingUrlPattern(s)');
    expect(r.stderr).toContain('never a clean tree');
  });

  it('FAILS LOUDLY when the pattern resolves but matches no collected page', () => {
    const rc = rcFixture(
      'rc-matches-nothing.cjs',
      "module.exports = { ci: { assert: { assertMatrix: [ { matchingUrlPattern: '.*/nothing\\\\.html$' } ] } } };\n",
    );
    const r = runReport(ramp('ramp-nomatch.json', 0.98), rc);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('matched 0 of 3 manifest entries');
  });

  // THE RULE (not merely a claim): a reporting feature that can crash or fail
  // the gate it reports on is worse than no report. The rule begins ONCE the
  // scope has resolved non-empty - an empty scope is a precondition failure and
  // is covered by the two RED legs above.
  it('the report path never alters the exit code', () => {
    for (const perf of [0, 0.5, 0.94, 0.95, 0.955, 0.96, 0.97, 1]) {
      const r = runReport(ramp(`ramp-exit-${perf}.json`, perf));
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
    }
  });
});
