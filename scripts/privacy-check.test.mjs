// Token-scoped test for the M2-05 publication allowlist in privacy-check.mjs
// (ADR-0011). Proves the allowlist clears ONLY the exact cleared token and does
// NOT blanket-open a file: a genuinely distinctive non-allowlisted token and a
// sensitive-class token (phone) in the SAME added lines still fail the gate.
//
// High fidelity, no gate-logic refactor: it drives the real CLI end-to-end
// (git diff parse → structural extraction → base-tree/example subtraction →
// PUBLISHED → phone/salary probes) against a scratch git repo. The scratch
// `docs/profile/` is left UNTRACKED — exactly as the real repo gitignores it —
// so `git grep <base>` does not subtract the planted tokens as public vocabulary.
//
// Positive control is `azure devops`: a REAL allowlist entry, but a public,
// non-secret tech name, so using it in a fictional scratch repo leaks nothing.
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./privacy-check.mjs', import.meta.url));

let repo;
const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
const write = (rel, body) => {
  const p = path.join(repo, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
};

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'privacy-check-test-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'pipe' });
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  // Untracked real profile (gitignored, like the real repo) — read from disk by
  // the extractor but never entering the base-tree subtraction corpus.
  write('.gitignore', 'docs/profile/\n');
  write(
    'docs/profile/skills.md',
    [
      '| Skill              | Category |',
      '| ------------------ | -------- |',
      '| azure devops       | devops   |', // real allowlist token (public tech)
      '| zzqbench framework | testing  |', // fictional distinctive token
      '',
    ].join('\n'),
  );
  // Fictional phone in tel: + human shapes so both probes fire.
  write('docs/profile/resume.md', '[206-555-0199](tel:+12065550199)\n');

  // The public example profile (tracked) — deliberately mirrors structure.
  write('docs/profile.example/skills.md', '| Skill | Category |\n| ----- | -------- |\n');

  git(['add', 'docs/profile.example', '.gitignore']);
  git(['commit', '-m', 'base', '--no-gpg-sign']);
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function runOnBranchAdding(lines) {
  git(['checkout', '-b', 'feature']);
  write('added.md', lines.join('\n') + '\n');
  git(['add', 'added.md']);
  git(['commit', '-m', 'add', '--no-gpg-sign']);
  try {
    const stdout = execSync(`node ${SCRIPT} ${repo}`, { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: `${e.stdout ?? ''}` };
  }
}

test('allowlisted token passes while a distinctive token and a phone in the same file still fail', () => {
  const { code, stdout } = runOnBranchAdding([
    'We used azure devops for the pipeline.', // allowlisted -> must NOT leak
    'We used zzqbench framework here too.', // distinctive -> MUST leak
    'Reach the team at 206-555-0199 today.', // phone -> MUST leak
  ]);
  // Token-scoped, not file-scoped: the allowlisted token is cleared (no `az…`
  // LEAK line) while, in the SAME added file, the distinctive token and the
  // sensitive-class phone are still caught.
  expect(code).toBe(1);
  expect(stdout).not.toContain('LEAK az'); // `azure devops` cleared by the allowlist
  expect(stdout).toContain('LEAK zz'); // distinctive token still fails
  expect(stdout).toContain('phone digits, normalized'); // sensitive class never allowlisted
});

test('the allowlist alone (no distinctive token, no phone) passes clean', () => {
  const { code, stdout } = runOnBranchAdding(['We used azure devops and terraform.']);
  expect(code).toBe(0);
  expect(stdout).toContain('PASS: zero real-profile strings in the diff');
});
