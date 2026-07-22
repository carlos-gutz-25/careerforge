// @vitest-environment node
//
// Unit tests for the case-study honesty validator (scripts/validate-case-studies
// .mjs). Rule functions are pure with dependency-injected resolvers, so most
// cases run with deterministic FAKE resolvers (no fs/git). One integration-
// flavored case binds the REAL repo resolvers against valid.md so the fixture's
// citations are proven to resolve in-tree (README.md, docs/BACKLOG.md, real SHAs,
// the M2-04 milestone token, the L-02 risk id, and the opaque projects.md token).
//
// Fixture isolation is a verified fact: content collections glob from content/,
// content-convention scans ../content/, and the validator's default target is
// content/case-studies/ — none of them sees tests/fixtures/.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateCaseStudy, verifyCitationSource } from '../scripts/validate-case-studies.mjs';

const fixturesDir = fileURLToPath(new URL('./fixtures/case-studies/', import.meta.url));
const read = (name: string) => readFileSync(fixturesDir + name, 'utf8');

// Deterministic fakes — know exactly the tokens valid.md cites.
const fake = {
  pathExists: (p: string) => ['README.md', 'docs/BACKLOG.md'].includes(p),
  shaResolves: (s: string) => ['ec37ecf', 'b7492b6'].includes(s),
  backlogText: 'stories include M2-04 case-study template + honesty labeling',
  risksText: 'L-02 employer-sensitive case-study content',
};
const run = (name: string) => validateCaseStudy(read(name), { filename: name, ...fake });
const rules = (name: string) => [...new Set(run(name).failures.map((f) => f.rule))].sort();

describe('validate-case-studies — the valid fixture', () => {
  it('passes with zero failures (fake resolvers)', () => {
    expect(run('valid.md').failures).toEqual([]);
  });

  it('accepts CORRECT numeric section prefixes (R6 optional-prefix path)', () => {
    // Assembled at RUNTIME: committed fixtures are unnumbered so they never
    // reproduce the private draft's `## N. Section` strings (the M2-04 privacy
    // catch). Numbering here proves a prefix equal to the position passes.
    let n = 0;
    const numbered = read('valid.md').replace(/^## (?!\d)/gm, () => `## ${(n += 1)}. `);
    expect(validateCaseStudy(numbered, { filename: 'valid-numbered', ...fake }).failures).toEqual([]);
  });

  it('passes against the REAL repo resolvers (citations resolve in-tree)', () => {
    const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
    const real = {
      pathExists: (rel: string) => existsSync(`${root}/${rel}`),
      shaResolves: (sha: string) =>
        spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root }).status === 0,
      backlogText: readFileSync(`${root}/docs/BACKLOG.md`, 'utf8'),
      risksText: readFileSync(`${root}/docs/RISKS.md`, 'utf8'),
    };
    expect(validateCaseStudy(read('valid.md'), { filename: 'valid.md', ...real }).failures).toEqual([]);
  });
});

describe('validate-case-studies — each bad fixture fires exactly its one rule', () => {
  const cases: [string, string][] = [
    ['missing-provenance.md', 'R2'],
    ['bad-provenance-token.md', 'R2'],
    ['professional-without-attestation.md', 'R3'],
    ['missing-section.md', 'R6'],
    ['out-of-order.md', 'R6'],
    ['empty-section.md', 'R7'],
    ['unsourced-results-claim.md', 'R8'],
    ['unresolvable-citation.md', 'R8'],
    ['body-h1.md', 'R4'],
    ['body-provenance-line.md', 'R5'],
    ['numbered-prefix-mismatch.md', 'R6'],
  ];
  for (const [name, rule] of cases) {
    it(`${name} → ${rule} only`, () => {
      expect(run(name).failures.length).toBeGreaterThan(0);
      expect(rules(name)).toEqual([rule]);
    });
  }
});

describe('verifyCitationSource — the R8 grammar', () => {
  it('accepts every source form', () => {
    expect(verifyCitationSource('docs/profile/projects.md', fake).ok).toBe(true); // opaque, presence never checked
    expect(verifyCitationSource('README.md', fake).ok).toBe(true);
    expect(verifyCitationSource('README.md:12-20', fake).ok).toBe(true);
    expect(verifyCitationSource('ec37ecf', fake).ok).toBe(true);
    expect(verifyCitationSource('M2-04', fake).ok).toBe(true);
    expect(verifyCitationSource('L-02', fake).ok).toBe(true);
    expect(verifyCitationSource('RISKS L-02', fake).ok).toBe(true);
  });

  it('rejects free prose (honesty theater) and unresolvable refs', () => {
    expect(verifyCitationSource('verified session evidence', fake).ok).toBe(false);
    expect(verifyCitationSource('docs/does-not-exist.md', fake).ok).toBe(false);
    expect(verifyCitationSource('deadbeef1', fake).ok).toBe(false); // SHA-shaped, does not resolve
    expect(verifyCitationSource('M9-99', fake).ok).toBe(false); // milestone not in BACKLOG
  });

  it('flags SHA-form citations so the CLI shallow-guard can fire', () => {
    expect(verifyCitationSource('ec37ecf', fake).isSha).toBe(true);
    expect(verifyCitationSource('README.md', fake).isSha).toBe(false);
  });
});
