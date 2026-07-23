// Token-scoped test for the M2-05 publication allowlist in privacy-check.mjs
// (ADR-0011). Proves the allowlist clears ONLY the exact cleared token and does
// NOT blanket-open a file: a genuinely distinctive non-allowlisted token and a
// sensitive-class token (phone) in the SAME added lines still fail the gate.
//
// M2-07 (ADR-0011 amendment): also proves the publication-staging-draft STRUCTURAL
// exclusion is correctly scoped. A distinctive bold/heading token from a real
// (non-draft) profile file still leaks, while the SAME classes of structural token
// in case-studies-draft.md are cleared — yet that draft's email, URL, phone, AND
// salary still fail. The email + URL legs are the ones a naive whole-file skip drops.
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
      '| firebase           | mobile   |', // M2-06 allowlist token (public tech)
      '| mocha              | testing  |', // M2-06 allowlist token (public tech)
      '| opencv             | vision   |', // M2-06 allowlist token (public tech)
      '| zzqbench framework | testing  |', // fictional distinctive token
      '',
    ].join('\n'),
  );
  // Fictional phone in tel: + human shapes so both probes fire.
  write('docs/profile/resume.md', '[206-555-0199](tel:+12065550199)\n');

  // A real (non-draft) profile file whose STRUCTURAL tokens (bold + heading) must
  // STILL be extracted — proves the staging-draft exclusion is scoped, not global.
  write(
    'docs/profile/projects.md',
    ['## Zxhead Line', '**zxstruct span** is a distinctive bold lead.', ''].join('\n'),
  );
  // A publication-staging draft (M2-07): its STRUCTURAL tokens are EXCLUDED, but
  // its sensitive classes (email/URL/phone/salary) must STILL be scanned.
  write(
    'docs/profile/case-studies-draft.md',
    [
      '## Qkdraft Heading',
      '**qkdraft lead span** for the study.',
      'Reach me at wmail@wexample.com or https://wsite-fic.example/p',
      'Call 415-555-0148 or tel:+14155550148',
      'Target comp $188,000 for the role.',
      '',
    ].join('\n'),
  );

  // M2-08 identity tokens (employers / title / school) as headings + bold, plus the
  // deliberately-published LinkedIn URL and a DIFFERENT private URL — drives the
  // identity allowlist test and the two-directional URL carve-out test below.
  write(
    'docs/profile/identity.md',
    [
      "## Love's Travel Stops & Country Stores",
      '## Nintendo of America',
      '## University of Washington',
      '**automation software engineer**',
      'Profile: https://www.linkedin.com/in/carlosgutz25/',
      'Private: https://www.linkedin.com/in/secret-private-xyz/',
      '',
    ].join('\n'),
  );

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

test('M2-06 allowlist (firebase/mocha/opencv) clears while a distinctive token and a phone in the same file still fail', () => {
  const { code, stdout } = runOnBranchAdding([
    'We built firebase push, wrote mocha tests, and ran opencv checks.', // 3 M2-06 tokens -> must NOT leak
    'We also used zzqbench framework here.', // distinctive -> MUST leak
    'Reach the team at 206-555-0199 today.', // phone -> MUST leak
  ]);
  // Adding three real allowlist entries did not blanket-open the file: the
  // fictional distinctive token and the sensitive-class phone are still caught.
  expect(code).toBe(1);
  expect(stdout).not.toContain('LEAK fi'); // firebase cleared by the allowlist
  expect(stdout).not.toContain('LEAK mo'); // mocha cleared by the allowlist
  expect(stdout).not.toContain('LEAK op'); // opencv cleared by the allowlist
  expect(stdout).toContain('LEAK zz'); // distinctive token still fails
  expect(stdout).toContain('phone digits, normalized'); // sensitive class never allowlisted
});

test('the allowlist alone (no distinctive token, no phone) passes clean', () => {
  const { code, stdout } = runOnBranchAdding(['We used azure devops and terraform.']);
  expect(code).toBe(0);
  expect(stdout).toContain('PASS: zero real-profile strings in the diff');
});

// M2-07 (a): structural extraction still fires for a real, non-draft profile file.
test('bold/heading tokens from a real (non-draft) profile file still leak', () => {
  const { code, stdout } = runOnBranchAdding([
    'Our team shipped zxstruct span this quarter.', // real-profile bold -> MUST leak
    'See the Zxhead Line section for details.', // real-profile heading -> MUST leak
  ]);
  // The staging-draft exclusion is scoped to case-studies-draft.md only; bold and
  // heading tokens from any real profile file are still caught.
  expect(code).toBe(1);
  expect(stdout).toContain('LEAK zx');
});

// M2-08 (a): the identity allowlist (employers / job title / school) clears the
// exact reviewed tokens while a distinctive fictional token and a phone in the SAME
// added file still fail — token-scoped, not a blanket open.
test('M2-08 identity allowlist clears while a distinctive token and a phone in the same file still fail', () => {
  const { code, stdout } = runOnBranchAdding([
    "I worked at Nintendo of America and Love's Travel Stops & Country Stores.", // 2 allowlisted -> must NOT leak
    'My title was automation software engineer; I studied at University of Washington.', // 2 allowlisted -> must NOT leak
    'We also used zzqbench framework here.', // distinctive -> MUST leak
    'Reach the team at 206-555-0199 today.', // phone -> MUST leak
  ]);
  expect(code).toBe(1);
  expect(stdout).not.toContain('LEAK ni'); // nintendo of america cleared
  expect(stdout).not.toContain('LEAK lo'); // love's travel stops & country stores cleared
  expect(stdout).not.toContain('LEAK au'); // automation software engineer cleared
  expect(stdout).not.toContain('LEAK un'); // university of washington cleared
  expect(stdout).toContain('LEAK zz'); // distinctive token still fails
  expect(stdout).toContain('phone digits, normalized'); // sensitive class never allowlisted
});

// M2-08 (b): the URL carve-out is NARROW. The exact deliberately-published
// professional-identity URL is cleared, but a DIFFERENT URL still LEAKs — proving
// it is not a blanket URL bypass. The two URLs differ only by length under the mask
// (identity = 41 chars, private = 47), so assert on the length-discriminated mask.
test('M2-08 LinkedIn URL carve-out clears the exact identity URL while a different URL still leaks', () => {
  const { code, stdout } = runOnBranchAdding([
    'Connect on https://www.linkedin.com/in/carlosgutz25/ for details.', // exact identity URL -> cleared
    'Internal only: https://www.linkedin.com/in/secret-private-xyz/ here.', // different URL -> MUST leak
  ]);
  expect(code).toBe(1);
  expect(stdout).toContain('FAIL: 1 leak'); // exactly one leak: the private URL, not the identity one
  expect(stdout).toContain('LEAK ht…(47)'); // the different/private URL still fails
  expect(stdout).not.toContain('LEAK ht…(41)'); // the exact identity URL is cleared by the carve-out
});

// M2-07 (b): the staging draft's STRUCTURAL tokens are cleared, but its
// email/URL/phone/salary still fail (the email + URL legs are what a naive
// whole-file skip would drop).
test('staging-draft structural tokens are cleared while its email/URL/phone/salary still fail', () => {
  const { code, stdout } = runOnBranchAdding([
    'The Qkdraft Heading and qkdraft lead span are reused verbatim.', // draft structural -> must NOT leak
    'Reach me at wmail@wexample.com or https://wsite-fic.example/p', // draft email + URL -> MUST leak
    'Call 415-555-0148 today.', // draft phone -> MUST leak
    'Target comp $188,000 for the role.', // draft salary -> MUST leak
  ]);
  // Structural tokens authored FOR publication are excluded for the draft...
  expect(stdout).not.toContain('LEAK qk');
  // ...while every sensitive class in that SAME draft is still detected.
  expect(code).toBe(1);
  expect(stdout).toContain('LEAK wm'); // email
  expect(stdout).toContain('LEAK ht'); // URL (the only https URL in the diff)
  expect(stdout).toContain('phone digits, normalized'); // phone
  expect(stdout).toContain('salary, normalized'); // salary
});
