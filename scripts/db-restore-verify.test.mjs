// M13-01 D8 pure-helper matrix for db-restore-verify.mjs. Docker-free/DB-free so
// it runs under `pnpm test` in CI; the container restore leg is proven by the
// slice-4 planted-FAIL demos (PF-4 corrupted dump, PF-5 manifest drift) + the
// operator drill. Covers newest-dump selection, the sibling-manifest name
// derivation, and the exact manifest compare (equal / count-drift / missing /
// extra table).
import { expect, test } from 'vitest';
import {
  compareManifest,
  dumpIsEncrypted,
  manifestNameForDump,
  pickNewestDump,
} from './db-restore-verify.mjs';

test('pickNewestDump returns the chronologically-latest dump, ignoring non-dumps', () => {
  const names = [
    'careerforge-db-20260601-030000.dump',
    'careerforge-db-20260803-210509.dump',
    'careerforge-db-20260701-030000.dump',
    'careerforge-db-20260803-210509.manifest.json', // not a dump
    'careerforge-notes.md',
  ];
  expect(pickNewestDump(names)).toBe('careerforge-db-20260803-210509.dump');
});

test('pickNewestDump returns null when no dump is present', () => {
  expect(pickNewestDump(['careerforge-notes.md', 'random.dump'])).toBeNull();
  expect(pickNewestDump([])).toBeNull();
});

test('manifestNameForDump derives the sibling manifest name', () => {
  expect(manifestNameForDump('careerforge-db-20260803-210509.dump')).toBe(
    'careerforge-db-20260803-210509.manifest.json',
  );
  expect(manifestNameForDump('not-a-dump.tar')).toBeNull();
});

// --- NC-1(b) cloud/encrypted branch -----------------------------------------
test('pickNewestDump includes .dump.age; newest wins across both forms', () => {
  const names = [
    'careerforge-db-20260601-030000.dump',
    'careerforge-db-20260803-210509.dump.age', // encrypted, newest
    'careerforge-db-20260701-030000.dump.age',
    'careerforge-db-20260803-210509.manifest.json', // not a dump
  ];
  expect(pickNewestDump(names)).toBe('careerforge-db-20260803-210509.dump.age');
});

test('manifestNameForDump derives the plaintext manifest from a .dump.age', () => {
  expect(manifestNameForDump('careerforge-db-20260803-210509.dump.age')).toBe(
    'careerforge-db-20260803-210509.manifest.json',
  );
});

test('dumpIsEncrypted: .dump.age true, plaintext .dump false, non-managed false', () => {
  expect(dumpIsEncrypted('careerforge-db-20260803-210509.dump.age')).toBe(true);
  expect(dumpIsEncrypted('careerforge-db-20260803-210509.dump')).toBe(false);
  expect(dumpIsEncrypted('not-a-dump.tar')).toBe(false);
});

test('compareManifest: identical counts pass', () => {
  const m = { postings: 4, accounts: 1 };
  expect(compareManifest(m, { ...m })).toEqual({ ok: true, diffs: [] });
});

test('compareManifest: a count drift is reported, value-free', () => {
  const { ok, diffs } = compareManifest({ postings: 4, accounts: 1 }, { postings: 3, accounts: 1 });
  expect(ok).toBe(false);
  expect(diffs).toEqual([{ table: 'postings', expected: 4, actual: 3 }]);
});

test('compareManifest: a table missing from the restore is reported (expected only)', () => {
  const { ok, diffs } = compareManifest({ postings: 4, accounts: 1 }, { postings: 4 });
  expect(ok).toBe(false);
  expect(diffs).toEqual([{ table: 'accounts', expected: 1, actual: null }]);
});

test('compareManifest: an unexpected extra restored table is reported (actual only)', () => {
  const { ok, diffs } = compareManifest({ postings: 4 }, { postings: 4, stowaway: 2 });
  expect(ok).toBe(false);
  expect(diffs).toEqual([{ table: 'stowaway', expected: null, actual: 2 }]);
});
