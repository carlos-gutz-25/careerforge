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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  // Fictional contact block (M6-01): H1 + bold title + tel link + two plain
  // location lines — one whose metro is PUBLISHED (mirrored into the example
  // base, so it must subtract) and one that is NOT (must leak as a contact
  // probe). The phone (tel: + human shapes) still fires the phone probes.
  write(
    'docs/profile/resume.md',
    [
      '# Fictional Person',
      '',
      '**Fictional Title**',
      '[206-555-0199](tel:+12065550199)',
      'Zzville, Fictionstate', // NOT in the base corpus -> a contact probe that leaks
      'Metroville, Publishedstate', // mirrored into the example base -> subtracted
      '',
      '## Professional Experience',
      '',
    ].join('\n'),
  );

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
  // M12-03: an untracked real facts.md. Its free-text `value:` is distinctive
  // (a facts probe that must LEAK); its closed-vocab stance value is mirrored
  // into the example base below (must SUBTRACT). Only the facts pass captures
  // these — they sit on `value:` lines, not headings/bold/table-cells.
  write(
    'docs/profile/facts.md',
    [
      '# Facts',
      '',
      '```yaml',
      'facts:',
      '  work_authorization:',
      '    value: "Zzfactburg work permit only"',
      '    declared: 2026-01-15',
      '  relocation_stance:',
      '    value: open_for_right_opportunity',
      '    declared: 2026-01-15',
      '  availability_notice:',
      '    value: "Two weeks"',
      '    declared: 2026-01-15',
      '    note: |', // a MULTI-LINE (block scalar) note; its continuation is sensitive
      '      Available after Zzblockmonth pending Zzblockclient signoff',
      '```',
      '',
    ].join('\n'),
  );

  write('docs/profile.example/skills.md', '| Skill | Category |\n| ----- | -------- |\n');
  // M6-01: the PUBLISHED metro location, mirrored into the tracked example so
  // it enters the public corpus (the M2-08-published-location analog). A branch
  // re-adding it must subtract clean — the contact pass never flags it.
  write('docs/profile.example/resume.md', '# Fictional Person\n\nMetroville, Publishedstate\n');
  // M12-03: the example facts.md mirrors the closed-vocab stance value so a
  // branch re-adding it subtracts clean (the M6-01-published-location analog);
  // the distinctive free-text value is NOT here, so it stays a leak.
  write(
    'docs/profile.example/facts.md',
    [
      '# Facts',
      '',
      '```yaml',
      'facts:',
      '  relocation_stance:',
      '    value: open_for_right_opportunity',
      '```',
      '',
    ].join('\n'),
  );

  git(['add', 'docs/profile.example', '.gitignore']);
  git(['commit', '-m', 'base', '--no-gpg-sign']);
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

// M16-01: every "cannot run" message is written to stderr, and this helper never
// read it. Without stderr the exit-2 plants below could assert only a CODE - and
// an exit-2 code alone is satisfiable by ANY of the four cannot-run arms, so each
// plant would certify nothing about the guard it names. The phrase binding is
// what keeps them separate tests. `stdio: 'pipe'` is what populates `e.stderr`;
// execSync otherwise forwards the child's stderr straight to the parent.
//
// `mutate` runs AFTER the commit, so a plant can break the environment the gate
// READS without changing what the branch diff CONTAINS. `script` lets a plant run
// a mutated COPY of the gate (PF-8) - the tracked script is never touched.
function runOnBranchAdding(lines, { mutate, script = SCRIPT } = {}) {
  git(['checkout', '-b', 'feature']);
  write('added.md', lines.join('\n') + '\n');
  git(['add', 'added.md']);
  git(['commit', '-m', 'add', '--no-gpg-sign']);
  if (mutate) mutate();
  try {
    const stdout = execSync(`node ${script} ${repo}`, {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: `${e.stdout ?? ''}`, stderr: `${e.stderr ?? ''}` };
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

// M6-01 (a): a plain contact-block location line that is NOT public corpus is
// captured by the contact-normalized pass and leaks. This is the gap the
// extractor closes — a location is invisible to the heading/bold/table-cell
// extractors unless it happens to sit in one of those structures.
test('PLANTED-FAIL: an unpublished contact location leaks via the contact-normalized pass', () => {
  const { code, stdout } = runOnBranchAdding([
    'We relocated the team to Zzville, Fictionstate last spring.',
  ]);
  expect(code).toBe(1);
  expect(stdout).toContain('(contact, normalized)'); // masked leak, never the value
  expect(stdout).toMatch(/LEAK zz\S* \(contact, normalized\)/);
});

// M6-01 (b): the SAME class of location, but one mirrored into the example base
// (the M2-08-published-metro analog), subtracts cleanly — public vocabulary
// must not flag. Proves the base-corpus subtraction applies in the normalized
// contact space, so the deliberately-published location never trips the gate.
test('a published contact location subtracts clean — no contact leak', () => {
  const { code, stdout } = runOnBranchAdding([
    'Our public bio lists Metroville, Publishedstate as the base.',
  ]);
  expect(code).toBe(0);
  expect(stdout).not.toContain('(contact, normalized)');
  expect(stdout).toContain('PASS: zero real-profile strings in the diff');
});

// M12-03 (a) PLANTED-FAIL: a free-text durable-fact value that is NOT public
// vocabulary leaks via the facts-normalized pass. This is the gap the extractor
// closes — a fact `value:` line is invisible to the heading/bold/table-cell
// extractors, and facts are a sensitive class (PUBLISHED never consulted here).
// Detection was DEMONSTRATED in the same change: neutering the facts pass turns
// exactly this test red (expected exit 1, got 0), other tests green; restoring
// makes it green again.
test('PLANTED-FAIL: an unpublished durable-fact value leaks via the facts-normalized pass', () => {
  const { code, stdout } = runOnBranchAdding([
    'We now require Zzfactburg work permit only for the role.',
  ]);
  expect(code).toBe(1);
  expect(stdout).toContain('(facts, normalized)'); // masked leak, never the value
  expect(stdout).toMatch(/LEAK zz\S* \(facts, normalized\)/);
});

// M12-03 (b): the SAME class of fact value, but a closed-vocab stance mirrored
// into the example base, subtracts cleanly — the enum vocabulary is public by
// design and must not flag. Proves the base-corpus subtraction applies in the
// normalized facts space, so declaring a stance never trips the gate.
test('a closed-vocab stance value mirrored in the example subtracts clean — no facts leak', () => {
  const { code, stdout } = runOnBranchAdding([
    'The team is open_for_right_opportunity on relocation.',
  ]);
  expect(code).toBe(0);
  expect(stdout).not.toContain('(facts, normalized)');
  expect(stdout).toContain('PASS: zero real-profile strings in the diff');
});

// M12-03: a MULTI-LINE (YAML block scalar) fact note's continuation text is
// still probed - a physical-line-only extractor would leave it unprobed, a
// silent hole in a sensitive-class backstop (the M12-03 code review). The
// scratch facts.md declares a block-scalar `note: |` whose continuation carries
// a distinctive token; adding that text to the diff must leak via the facts pass.
test('PLANTED-FAIL: a multi-line block-scalar fact note leaks via the facts-normalized pass', () => {
  const { code, stdout } = runOnBranchAdding([
    'Team update: Available after Zzblockmonth pending Zzblockclient signoff, all set.',
  ]);
  expect(code).toBe(1);
  expect(stdout).toContain('(facts, normalized)');
  expect(stdout).toMatch(/LEAK av\S* \(facts, normalized\)/);
});

// ---------------------------------------------------------------------------
// M16-01: the exit-code contract. Exit 1 means "the scan ran and found a leak";
// every environmental failure - a missing base ref, an unreadable profile file,
// an unreadable public example corpus - must exit 2 = "cannot run", never 1.
// Before this story four such paths exited 1, so a gate that could not LOOK was
// indistinguishable from a gate that had FOUND something.
//
// Each exit-2 plant binds to its own PHRASE, not merely to the code. Four arms
// now exit 2, so a code-only assertion is satisfiable by any of the other three
// and would certify nothing about the guard it names.
// ---------------------------------------------------------------------------

// PF-1: real profile PRESENT, base ref ABSENT. This is the one shape anybody has
// actually hit (the PR#202 host run). `beforeEach` always creates `main`, so the
// plant deletes it after branching - after which `git diff main...HEAD` throws.
// The profile MUST be present: a profile-less PF-1 exits 2 at the no-profile arm
// before the diff is ever attempted, and would pass having tested nothing.
test('PF-1 PLANTED-FAIL: a missing base ref exits 2 "cannot run", not 1 "leak"', () => {
  const { code, stderr } = runOnBranchAdding(['Nothing distinctive in this line.'], {
    mutate: () => git(['branch', '-D', 'main']),
  });
  expect(code).toBe(2);
  expect(stderr).toContain('does not resolve');
  expect(stderr).toContain('Not a pass.');
});

// PF-2: the alarm must still fire under the new code. A fix that only proves the
// 2 is half a proof - the whole point is that the alarm and the failure stay
// DISTINGUISHABLE. This story changes REPORTING, never detection.
test('PF-2: a real leak still exits 1 with LEAK on stdout, unchanged by the guards', () => {
  const { code, stdout } = runOnBranchAdding(['We used zzqbench framework on this branch.']);
  expect(code).toBe(1);
  expect(stdout).toContain('LEAK zz');
});

// PF-3: the pass state is untouched.
test('PF-3: a clean branch still exits 0 with PASS', () => {
  const { code, stdout } = runOnBranchAdding(['We used azure devops and terraform.']);
  expect(code).toBe(0);
  expect(stdout).toContain('PASS: zero real-profile strings in the diff');
});

// PF-4: the pre-existing no-profile arm. It predates this story and is NOT
// modified by it - but no test asserted exit 2 at all before now, so the
// already-correct path was also the untested one.
test('PF-4: no real profile at all exits 2 with the no-profile phrase', () => {
  const { code, stderr } = runOnBranchAdding(['Nothing distinctive in this line.'], {
    mutate: () => rmSync(path.join(repo, 'docs', 'profile'), { recursive: true, force: true }),
  });
  expect(code).toBe(2);
  expect(stderr).toContain('no real profile markdown');
  expect(stderr).toContain('Not a pass.');
});

// PF-5: the public example corpus removed from the WORKING TREE after the commit.
// The tree object still holds it, so the branch diff still computes and the run
// reaches the example-corpus read exactly as intended. The repo's real
// docs/profile.example/ is never touched - only this scratch repo's copy.
test('PF-5 PLANTED-FAIL: an unreadable public example corpus exits 2, not 1', () => {
  const { code, stderr } = runOnBranchAdding(['Nothing distinctive in this line.'], {
    mutate: () =>
      rmSync(path.join(repo, 'docs', 'profile.example'), { recursive: true, force: true }),
  });
  expect(code).toBe(2);
  expect(stderr).toContain('example corpus');
  expect(stderr).toContain('Not a pass.');
});

// PF-6 and PF-7 use a directory-for-file swap, chosen for DETERMINISM. The
// underlying defect is a read-after-listing race, and a race is the one thing a
// test must not try to reproduce by timing. The name still passes the `.md`
// filter at the listing, so the read is still attempted, and readFileSync on a
// directory throws EISDIR every time on every platform. `chmod 000` was the
// obvious alternative and is rejected: it is a no-op as root, which is exactly
// the CI case - a plant that stops discriminating where it matters most.
const swapForDirectory = (rel) => () => {
  const p = path.join(repo, rel);
  rmSync(p, { force: true });
  mkdirSync(p, { recursive: true });
};

test('PF-6 PLANTED-FAIL: an unreadable real-profile file exits 2, not 1', () => {
  const { code, stderr } = runOnBranchAdding(['Nothing distinctive in this line.'], {
    mutate: swapForDirectory('docs/profile/skills.md'),
  });
  expect(code).toBe(2);
  expect(stderr).toContain('cannot read the real profile');
  expect(stderr).toContain('Not a pass.');
});

test('PF-7 PLANTED-FAIL: an unreadable example-corpus file exits 2, not 1', () => {
  const { code, stderr } = runOnBranchAdding(['Nothing distinctive in this line.'], {
    mutate: swapForDirectory('docs/profile.example/skills.md'),
  });
  expect(code).toBe(2);
  expect(stderr).toContain('example corpus');
  expect(stderr).toContain('Not a pass.');
});

// PF-8 is the control that proves the profile guard is NARROW, and no other leg
// can catch what it catches. The guard wraps the READ CALL only; a region guard
// over the whole profile loop would swallow any DETECTION throw and report it as
// "cannot read the real profile" - a truthful exit 2 carrying a false reason,
// which is this gate's own defect rebuilt inside its own fix. PF-2 stays green in
// that world (detection still works on the happy path) and PF-6 only proves the
// read can throw, so without PF-8 a too-wide guard ships unseen.
//
// The other legs mutate FIXTURES; PF-8 cannot, because the harness drives the
// real repo script by a fixed path. So it copies the gate into the scratch repo,
// plants the throw in the COPY, and runs the copy - the tracked script is never
// mutated, which keeps the plant off the committed tree.
const PLANT_ANCHOR = '  const extractors = STAGING_DRAFTS.has(file)';

test('PF-8: a throw in the DETECTION machinery does NOT exit 2 - the guard stays narrow', () => {
  const copy = path.join(repo, 'planted-privacy-check.mjs');
  const source = readFileSync(SCRIPT, 'utf8');
  // Fail loudly if the anchor ever moves, rather than silently planting nothing
  // and reporting a green that means the opposite of what it says.
  expect(source).toContain(PLANT_ANCHOR);
  writeFileSync(
    copy,
    source.replace(
      PLANT_ANCHOR,
      "  throw new Error('planted detection failure (PF-8)');\n" + PLANT_ANCHOR,
    ),
  );

  const { code, stderr } = runOnBranchAdding(['Nothing distinctive in this line.'], {
    script: copy,
  });

  // It may crash loudly (node's default 1) or exit 1 from a real leak. What it
  // must NEVER do is report a detection bug as "cannot read the real profile".
  expect(code).not.toBe(2);
  expect(stderr).not.toContain('cannot read the real profile');
  expect(stderr).toContain('planted detection failure (PF-8)');
});
