// Unit tests for the M14-08 pin-coupling guard.
//
// These are NOT the plant suite and do not replace it. The plants
// (scripts/check-playwright-pin-plants.sh) demonstrate that the wired gate can
// fail, which is the verification law's requirement; these tests pin the
// comparison and validation logic directly, which is cheaper and finer-grained
// - especially the malformed-input paths, where the interesting behaviour is
// WHICH input gets named in the message.
//
// Drives the real CLI end-to-end against scratch fixtures, in the shape
// privacy-check.test.mjs established. Every fixture version is fabricated.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./check-playwright-pin.mjs', import.meta.url));
const REAL_DOCKERFILE = fileURLToPath(new URL('../.devcontainer/Dockerfile', import.meta.url));

let dir;

const run = (...args) => {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: stdout, err: '' };
  } catch (err) {
    return { code: err.status, out: err.stdout ?? '', err: err.stderr ?? '' };
  }
};

// Shaped like the real bake line, surroundings included, so the extraction is
// tested against realistic context rather than a bare token.
const dockerfileWith = (bake) => {
  const p = path.join(dir, 'Dockerfile');
  writeFileSync(
    p,
    [
      'RUN set -eux \\',
      `    && npx -y playwright@${bake} install --with-deps chromium \\`,
      '    && rm -rf /var/lib/apt/lists/*',
      '',
    ].join('\n'),
  );
  return p;
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'check-playwright-pin-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('exit 0 - the invariant holds', () => {
  test('baked equals resolved', () => {
    const r = run(dockerfileWith('1.62.1'), '1.62.1');
    expect(r.code).toBe(0);
    expect(r.out).toContain('PIN OK: playwright 1.62.1');
  });
});

describe('exit 1 - MISMATCH, the drift this guard exists to catch', () => {
  test('reds and prints both values and the path', () => {
    const df = dockerfileWith('1.61.1');
    const r = run(df, '1.62.1');
    expect(r.code).toBe(1);
    expect(r.err).toContain('PIN MISMATCH:');
    expect(r.err).toContain('baked=1.61.1');
    expect(r.err).toContain('resolved=1.62.1');
    expect(r.err).toContain(`dockerfile=${df}`);
  });

  // The comparison is equality, never substring or prefix. "1.62.11" contains
  // "1.62.1"; a loose guard would call this drift a match. This is the case the
  // plant suite's firing control turns on.
  test('1.62.11 against 1.62.1 is a MISMATCH, not a prefix match', () => {
    const r = run(dockerfileWith('1.62.11'), '1.62.1');
    expect(r.code).toBe(1);
    expect(r.err).toContain('baked=1.62.11');
  });
});

describe('exit 2 - CANNOT RUN, never reported as a pass', () => {
  test.each([
    ['no arguments', []],
    ['one argument', ['only-one']],
    ['three arguments', ['a', 'b', 'c']],
  ])('%s is an argc failure', (_name, args) => {
    const r = run(...args);
    expect(r.code).toBe(2);
    expect(r.err).toContain('CANNOT DETERMINE: argc received');
  });

  // The shape ci.yml produces during an outage: the extraction fails, the echo
  // still succeeds, and `version=` is published. The guard must not compare the
  // bake against nothing and call it OK.
  test.each([
    ['empty (the ci.yml fail-open shape)', ''],
    ['not a version at all', 'not-a-version'],
    ['truncated to two components', '1.62'],
    // A prerelease resolution is a thing a human should rule on, so the guard
    // fails closed rather than widening its pattern to admit it.
    ['a prerelease', '1.63.0-alpha.1'],
  ])('resolved version %s is named as the malformed input', (_name, resolved) => {
    const r = run(dockerfileWith('1.62.1'), resolved);
    expect(r.code).toBe(2);
    expect(r.err).toContain('CANNOT DETERMINE: resolved-version received');
    expect(r.err).toContain(JSON.stringify(resolved));
  });

  test('an unreadable Dockerfile names the dockerfile input', () => {
    const r = run(path.join(dir, 'does-not-exist'), '1.62.1');
    expect(r.code).toBe(2);
    expect(r.err).toContain('CANNOT DETERMINE: dockerfile received');
    expect(r.err).toContain('ENOENT');
  });

  test('a Dockerfile with no bake line at all names the bake-line input', () => {
    const p = path.join(dir, 'Dockerfile');
    writeFileSync(p, 'FROM node:22\nRUN echo no browser here\n');
    const r = run(p, '1.62.1');
    expect(r.code).toBe(2);
    expect(r.err).toContain('CANNOT DETERMINE: bake-line received');
  });

  test('a bake line that parses to a non-version names the baked input', () => {
    const r = run(dockerfileWith('not-a-version'), '1.62.1');
    expect(r.code).toBe(2);
    expect(r.err).toContain('CANNOT DETERMINE: baked-version received "not-a-version"');
  });
});

// Guards the extraction against the file it actually runs on. If the bake line
// is reworded or moved, this reds here rather than in CI as a "cannot
// determine" nobody expected.
describe('the real .devcontainer/Dockerfile', () => {
  test('its bake line is extractable, whatever version it currently carries', () => {
    const r = run(REAL_DOCKERFILE, '0.0.0');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/PIN MISMATCH: baked=[0-9]+\.[0-9]+\.[0-9]+ /);
  });
});
