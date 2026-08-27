// M14-08 pin-coupling guard: the .devcontainer bake must equal the version the
// committed lockfile resolves for apps/web's @playwright/test.
//
// The bake at .devcontainer/Dockerfile is a remembered CONSTANT; the lockfile
// is the resolution of a caret range. Nothing structural keeps the two in step,
// and on 2026-08-14 they drifted (bake 1.61.1/chromium-1228 against a lockfile
// on 1.62.1/chromium-1234). Lighthouse and axe kept passing - they take
// CHROME_PATH directly - while pnpm test:e2e failed at browser launch, so the
// drift read as a flake. This guard turns that into a merge-blocking red.
//
//   node scripts/check-playwright-pin.mjs <dockerfile-path> <resolved-version>
//
// The resolved version is passed IN, by the ci.yml step that already derives it
// (`playwright --version`), rather than re-derived here: a second extraction is
// a second thing that can disagree with the first.
//
// Exit codes - the three-value contract this repo ratified for
// scripts/privacy-check.mjs, adopted deliberately rather than invented:
//   0 = baked equals resolved. The invariant holds.
//   1 = MISMATCH. The drift this guard exists to catch.
//   2 = CANNOT RUN. Wrong argc, an unreadable Dockerfile, no bake line, or an
//       argument that is not ^\d+\.\d+\.\d+$. NEVER reported as a pass, and
//       never conflated with 1 - a cannot-run reported as a verdict destroys
//       the gate's meaning (the M16-01 lesson).
//
// The validation is the point, not paranoia. ci.yml's extraction step is
// `echo "version=$(pnpm ... playwright --version | sed ...)"`: if pnpm exec
// fails, the substitution yields an EMPTY STRING, the echo still succeeds, and
// the step exits 0 having published `version=`. A guard that compared against
// that would report on nothing while looking green. So both inputs are checked
// before either is compared, and an unparseable input is a failure OF THE
// GUARD, not a pass of the invariant.
import { readFileSync } from 'node:fs';

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// A three-part pattern REJECTS a prerelease resolution (1.63.0-alpha.1). That
// is deliberate: a prerelease playwright is a thing a human should rule on, so
// the guard fails closed and blocks CI until one does. Do not "fix" that red by
// widening this pattern.
const cannotDetermine = (which, received) => {
  process.stderr.write(`CANNOT DETERMINE: ${which} received ${received}\n`);
  process.exit(2);
};

const args = process.argv.slice(2);

// argc FIRST, before anything is read or compared. ci.yml passes the resolved
// version through env: and quotes it, so the empty case arrives as a second
// argument rather than vanishing - but an unquoted caller would drop it, and
// `undefined` flowing into a comparison is exactly the silent path this
// contract exists to remove.
if (args.length !== 2) {
  cannotDetermine(
    'argc',
    `${args.length} arguments (expected 2: <dockerfile-path> <resolved-version>)`,
  );
}

const [dockerfilePath, resolved] = args;

if (!VERSION.test(resolved)) {
  cannotDetermine('resolved-version', JSON.stringify(resolved));
}

let dockerfile;
try {
  dockerfile = readFileSync(dockerfilePath, 'utf8');
} catch (err) {
  cannotDetermine(
    'dockerfile',
    `${JSON.stringify(dockerfilePath)} (unreadable: ${String((err && err.code) || err)})`,
  );
}

// Captured loosely, then validated, so a reworded or corrupted bake line names
// what it actually found instead of collapsing into "no line found". The
// Dockerfile carries exactly one such line; the first match is that line.
const bake = dockerfile.match(/playwright@(\S+)/);
if (!bake) {
  cannotDetermine(
    'bake-line',
    `no "playwright@<version>" line in ${JSON.stringify(dockerfilePath)}`,
  );
}

const baked = bake[1];
if (!VERSION.test(baked)) {
  cannotDetermine('baked-version', JSON.stringify(baked));
}

// Equality, never substring or prefix: "1.62.11" starts with "1.62.1" and a
// loose comparison would call that drift a match. A plant covers it.
if (baked !== resolved) {
  process.stderr.write(
    `PIN MISMATCH: baked=${baked} resolved=${resolved} dockerfile=${dockerfilePath}\n`,
  );
  process.exit(1);
}

process.stdout.write(`PIN OK: playwright ${baked}\n`);
