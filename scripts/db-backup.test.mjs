// M13-01 D8 pure-helper matrix for db-backup.mjs. Docker-free and DB-free so it
// runs under `pnpm test` in CI (which has no compose Postgres for this project);
// the container legs are proven by the slice-4 planted-FAIL demos + the operator
// drill instead. Covers: .env parse, filename/timestamp shape, the D3 inside-repo
// detection (incl. a real symlink resolving into the repo) + device-ID gate, the
// D5 BASE-TABLE enumeration filter + count parse, and the D7 exact-prune matcher
// (never delete a file the script did not create).
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  assertOffPrimaryDisk,
  backupFilenames,
  filterBaseTables,
  formatTimestamp,
  isInsideOrEqual,
  parseCountOutput,
  parseDotEnv,
  parseStamp,
  resolveDestination,
  selectForPruning,
  selectPgContainer,
  timestampFromArtifact,
} from './db-backup.mjs';

// --- parseDotEnv ------------------------------------------------------------
test('parseDotEnv: skips comments/blanks, strips one quote layer, no expansion', () => {
  const env = parseDotEnv(
    [
      '# comment',
      '',
      'POSTGRES_USER=careerforge',
      'BACKUP_DIR="/Volumes/b ackup"',
      "X='y'",
      'LIT=$HOME/x',
      'HAS=a=b',
    ].join('\n'),
  );
  expect(env.POSTGRES_USER).toBe('careerforge');
  expect(env.BACKUP_DIR).toBe('/Volumes/b ackup');
  expect(env.X).toBe('y');
  expect(env.LIT).toBe('$HOME/x'); // literal, never expanded
  expect(env.HAS).toBe('a=b'); // only the first = splits
  expect(env['# comment']).toBeUndefined();
});

// --- timestamp + filenames --------------------------------------------------
test('formatTimestamp is YYYYMMDD-HHMMSS and round-trips through parseStamp', () => {
  const d = new Date(2026, 7, 3, 21, 5, 9); // local
  expect(formatTimestamp(d)).toBe('20260803-210509');
  expect(parseStamp('20260803-210509')).toBe(d.getTime());
});

test('backupFilenames yields the three dated artifact names', () => {
  expect(backupFilenames('20260803-210509')).toEqual({
    dump: 'careerforge-db-20260803-210509.dump',
    manifest: 'careerforge-db-20260803-210509.manifest.json',
    profile: 'careerforge-profile-20260803-210509.tar',
  });
});

// --- D3 inside-repo detection ----------------------------------------------
test('isInsideOrEqual: equal + nested true; sibling-with-shared-prefix false', () => {
  expect(isInsideOrEqual('/repo', '/repo')).toBe(true);
  expect(isInsideOrEqual('/repo/backups', '/repo')).toBe(true);
  expect(isInsideOrEqual('/repo-backups', '/repo')).toBe(false); // prefix but not nested
  expect(isInsideOrEqual('/elsewhere', '/repo')).toBe(false);
});

test('resolveDestination throws when BACKUP_DIR is unset', () => {
  expect(() => resolveDestination('', '/repo')).toThrow(/BACKUP_DIR is not set/);
  expect(() => resolveDestination(undefined, '/repo')).toThrow(/BACKUP_DIR is not set/);
});

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'm13-backup-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test('resolveDestination rejects a real symlink that resolves INTO the repo (D3)', () => {
  const repo = join(tmp, 'repo');
  const inside = join(repo, 'backups');
  mkdirSync(inside, { recursive: true });
  const outside = join(tmp, 'link-outside'); // outside the repo by name...
  symlinkSync(inside, outside); // ...but realpath resolves inside it
  expect(() => resolveDestination(outside, repo)).toThrow(/inside the repository/);
});

test('resolveDestination accepts a genuinely-outside destination', () => {
  const repo = join(tmp, 'repo');
  const dest = join(tmp, 'external');
  mkdirSync(repo, { recursive: true });
  mkdirSync(dest, { recursive: true });
  const { destReal, repoReal } = resolveDestination(dest, repo);
  expect(isInsideOrEqual(destReal, repoReal)).toBe(false);
});

// --- D3 device gate ---------------------------------------------------------
test('assertOffPrimaryDisk: same device throws unless BACKUP_SAME_DEVICE_OK', () => {
  const sameDev = { stat: () => ({ dev: 42 }) };
  expect(() => assertOffPrimaryDisk('/ext', '/repo', false, sameDev)).toThrow(
    /same filesystem device/,
  );
  expect(() => assertOffPrimaryDisk('/ext', '/repo', true, sameDev)).not.toThrow();
});

test('assertOffPrimaryDisk: different device always passes', () => {
  const diffDev = { stat: (p) => ({ dev: p === '/ext' ? 7 : 42 }) };
  expect(() => assertOffPrimaryDisk('/ext', '/repo', false, diffDev)).not.toThrow();
});

// --- container disambiguation (never back up the wrong DB) ------------------
test('selectPgContainer: single match returns it; none returns null', () => {
  expect(selectPgContainer(['careerforge-postgres-1'], undefined)).toBe('careerforge-postgres-1');
  expect(selectPgContainer([], undefined)).toBeNull();
});

test('selectPgContainer: multiple matches FAIL LOUD (never silently pick a DB)', () => {
  expect(() => selectPgContainer(['a-postgres-1', 'b-postgres-1'], undefined)).toThrow(
    /multiple compose Postgres containers.*BACKUP_PG_CONTAINER/s,
  );
});

test('selectPgContainer: an explicit override must be among the running set', () => {
  expect(selectPgContainer(['a-postgres-1', 'b-postgres-1'], 'b-postgres-1')).toBe('b-postgres-1');
  expect(() => selectPgContainer(['a-postgres-1'], 'ghost-1')).toThrow(
    /not a running compose Postgres/,
  );
});

// --- D5 enumeration filter + count parse -----------------------------------
test('filterBaseTables keeps only BASE TABLE, sorted', () => {
  const rows = [
    { table_name: 'postings', table_type: 'BASE TABLE' },
    { table_name: 'active_view', table_type: 'VIEW' },
    { table_name: 'accounts', table_type: 'BASE TABLE' },
  ];
  expect(filterBaseTables(rows)).toEqual(['accounts', 'postings']);
});

test('parseCountOutput parses TSV, ignores malformed lines', () => {
  expect(parseCountOutput('postings\t4\naccounts\t1\n\ngarbage\nviews\tNaN')).toEqual({
    postings: 4,
    accounts: 1,
  });
});

// --- D7 exact-prune matcher (never delete a non-managed file) ---------------
test('timestampFromArtifact matches only the managed patterns (incl. .age variants)', () => {
  expect(timestampFromArtifact('careerforge-db-20260803-210509.dump')).toBe('20260803-210509');
  expect(timestampFromArtifact('careerforge-db-20260803-210509.manifest.json')).toBe(
    '20260803-210509',
  );
  expect(timestampFromArtifact('careerforge-profile-20260803-210509.tar')).toBe('20260803-210509');
  // NC-1(b) cloud variants: the dump + tar take a .age suffix, still managed
  expect(timestampFromArtifact('careerforge-db-20260803-210509.dump.age')).toBe('20260803-210509');
  expect(timestampFromArtifact('careerforge-profile-20260803-210509.tar.age')).toBe(
    '20260803-210509',
  );
  // non-managed -> null (untouchable)
  expect(timestampFromArtifact('careerforge-notes.md')).toBeNull();
  expect(timestampFromArtifact('my-manual.dump')).toBeNull();
  expect(timestampFromArtifact('careerforge-db-BADDATE.dump')).toBeNull();
  // the manifest is never encrypted, so a .age manifest is NOT ours -> untouchable
  expect(timestampFromArtifact('careerforge-db-20260803-210509.manifest.json.age')).toBeNull();
});

test('selectForPruning: only matching-AND-stale is deletable; others survive', () => {
  const now = new Date(2026, 7, 3, 21, 0, 0).getTime();
  const fresh = '20260801-030000'; // 2 days old
  const stale = '20260601-030000'; // ~63 days old
  const names = [
    `careerforge-db-${fresh}.dump`, // matching but fresh -> survives
    `careerforge-db-${stale}.dump`, // matching + stale -> doomed
    `careerforge-db-${stale}.manifest.json`, // matching + stale -> doomed
    `careerforge-profile-${stale}.tar`, // matching + stale -> doomed
    'careerforge-notes.md', // non-managed -> survives even though "old"
    'random-file.dump', // non-managed .dump -> survives
  ];
  const doomed = selectForPruning(names, now, 30);
  expect(doomed.sort()).toEqual(
    [
      `careerforge-db-${stale}.dump`,
      `careerforge-db-${stale}.manifest.json`,
      `careerforge-profile-${stale}.tar`,
    ].sort(),
  );
});

test('selectForPruning: .age cloud variants prune too (dump + tar, never the manifest)', () => {
  const now = new Date(2026, 7, 3, 21, 0, 0).getTime();
  const fresh = '20260801-030000'; // 2 days old
  const stale = '20260601-030000'; // ~63 days old
  const names = [
    `careerforge-db-${stale}.dump.age`, // stale encrypted dump -> doomed
    `careerforge-profile-${stale}.tar.age`, // stale encrypted tar -> doomed
    `careerforge-db-${fresh}.dump.age`, // fresh encrypted dump -> survives
    `careerforge-db-${stale}.manifest.json.age`, // a .age manifest is not ours -> survives
  ];
  const doomed = selectForPruning(names, now, 30);
  expect(doomed.sort()).toEqual(
    [`careerforge-db-${stale}.dump.age`, `careerforge-profile-${stale}.tar.age`].sort(),
  );
});
