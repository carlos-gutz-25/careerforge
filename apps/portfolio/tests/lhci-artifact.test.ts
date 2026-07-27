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

// Write a fixture manifest and return its path.
function fixture(name: string, data: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(data), 'utf8');
  return p;
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
