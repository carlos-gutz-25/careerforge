// M13-01 restore verification (F-5). Restores the newest db:backup dump into a
// DISPOSABLE scratch database inside the compose container, compares per-table
// row counts against the dump's own manifest (exact equality), and ALWAYS drops
// the scratch DB afterwards. Proves a dump/restore round-trip end to end without
// ever touching the real database.
//
// Hard safety (D9): the scratch DB name is a fixed constant and the script
// REFUSES to run if it equals POSTGRES_DB; no code path issues `down -v`, drops
// pgdata, or drops any database other than the fixed scratch name. Restore runs
// inside the container over the unix socket (no password; D2). The dump is fed to
// pg_restore over STDIN (D12: the host backup dir is never mounted into compose).
//
// PASS = pg_restore exit 0 AND the restored table set is identical to the manifest
// AND every count is exactly equal. Anything else exits non-zero with a value-free
// diff (table names + expected/actual integer counts only).
//
// NC-1(b) cloud/encrypted branch: a dump whose name ends `.dump.age` is decrypted
// on the host with `age -d -i "$BACKUP_AGE_IDENTITY_FILE"` (identity file OUTSIDE
// the repo, name-only in .env.example, never read/printed/committed) and the
// plaintext is fed to pg_restore over the same D12 STDIN seam. A plaintext dump
// (external-drive branch, or an operator-provided --file) skips decryption. NC-5
// stays operator-attended, so the identity/key material stays in Carlos's hands.
//
// Usage: BACKUP_DIR=/Volumes/backup pnpm db:restore:verify   (or --file <dump>)

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  filterBaseTables,
  isInsideOrEqual,
  listPgContainers,
  parseCountOutput,
  parseDotEnv,
  selectPgContainer,
} from './db-backup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DB = 'careerforge_restore_verify';
// Matches both the plaintext dump and the NC-1(b) `.dump.age` ciphertext (group 2
// captures the `.age` suffix when present, so dumpIsEncrypted can branch on it).
const DUMP_RE = /^careerforge-db-(\d{8}-\d{6})\.dump(\.age)?$/;

// ---------------------------------------------------------------------------
// Pure helpers (D8: exported, unit-tested in db-restore-verify.test.mjs).
// ---------------------------------------------------------------------------

// Newest dump by timestamp (lexical sort of YYYYMMDD-HHMMSS is chronological).
export function pickNewestDump(names) {
  const dumps = names.filter((n) => DUMP_RE.test(n)).sort();
  return dumps.length > 0 ? dumps[dumps.length - 1] : null;
}

// Manifest path that must sit beside a dump: careerforge-db-<ts>.dump[.age] ->
// careerforge-db-<ts>.manifest.json (the manifest is plaintext on both branches).
export function manifestNameForDump(dumpName) {
  const m = DUMP_RE.exec(dumpName);
  if (!m) return null;
  return `careerforge-db-${m[1]}.manifest.json`;
}

// True iff the dump name is a managed dump that ends `.dump.age` (NC-1(b)): the
// signal to route it through `age -d` before pg_restore. A plaintext `.dump`
// (external-drive branch) or a non-managed name returns false.
export function dumpIsEncrypted(dumpName) {
  const m = DUMP_RE.exec(dumpName);
  return m ? m[2] === '.age' : false;
}

// Exact compare of expected (manifest.tables) vs actual counts. Reports every
// table whose count differs OR that is present in only one side. Value-free.
export function compareManifest(expected, actual) {
  const tables = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const diffs = [];
  for (const table of tables) {
    const e = Object.prototype.hasOwnProperty.call(expected, table) ? expected[table] : null;
    const a = Object.prototype.hasOwnProperty.call(actual, table) ? actual[table] : null;
    if (e !== a) diffs.push({ table, expected: e, actual: a });
  }
  return { ok: diffs.length === 0, diffs };
}

// ---------------------------------------------------------------------------
// Impure runtime (main): docker + fs. Proven by slice-4 demos + operator drill.
// ---------------------------------------------------------------------------

function die(message) {
  process.stderr.write(`db-restore-verify: ${message}\n`);
  process.exit(1);
}

// Run a pg tool inside the discovered container (unix socket -> no password).
// `-i` when input is piped (D12). Mirrors db-backup.mjs's dockerExec.
function dockerExec(container, cmd, { stdin = false, ...spawnOpts } = {}) {
  return spawnSync('docker', ['exec', ...(stdin ? ['-i'] : []), container, ...cmd], spawnOpts);
}

function main() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) die('.env not found at repo root');
  const env = parseDotEnv(readFileSync(envPath, 'utf8'));
  const pgUser = process.env.POSTGRES_USER ?? env.POSTGRES_USER;
  const pgDb = process.env.POSTGRES_DB ?? env.POSTGRES_DB;
  if (!pgUser || !pgDb) die('POSTGRES_USER / POSTGRES_DB not found in .env');
  if (SCRATCH_DB === pgDb) die(`refusing to run: scratch name equals POSTGRES_DB (${pgDb})`);

  // Resolve the dump: explicit --file, else newest in BACKUP_DIR. Either way it
  // must realpath OUTSIDE the repo.
  const fileArgIdx = process.argv.indexOf('--file');
  let dumpPath;
  if (fileArgIdx !== -1) {
    const arg = process.argv[fileArgIdx + 1];
    if (!arg) die('--file needs a path');
    if (!existsSync(arg)) die(`--file not found: ${arg}`);
    dumpPath = realpathSync(arg);
  } else {
    const backupDir = process.env.BACKUP_DIR ?? env.BACKUP_DIR;
    if (!backupDir) die('BACKUP_DIR is not set (or pass --file <dump>)');
    if (!existsSync(backupDir)) die(`BACKUP_DIR does not exist: ${backupDir}`);
    const destReal = realpathSync(backupDir);
    const newest = pickNewestDump(readdirSync(destReal));
    if (!newest) die(`no careerforge-db-*.dump found in BACKUP_DIR`);
    dumpPath = join(destReal, newest);
  }
  const repoReal = realpathSync(REPO_ROOT);
  if (isInsideOrEqual(dumpPath, repoReal)) die('dump resolves inside the repo - refusing (D3)');

  // Sibling manifest is required.
  const manifestName = manifestNameForDump(basename(dumpPath));
  if (!manifestName) die('dump filename is not a careerforge-db-<ts>.dump');
  const manifestPath = join(dirname(dumpPath), manifestName);
  if (!existsSync(manifestPath)) die(`manifest not found beside the dump: ${manifestName}`);
  let expected;
  try {
    expected = JSON.parse(readFileSync(manifestPath, 'utf8')).tables ?? {};
  } catch {
    die('could not parse the manifest');
  }

  // NC-1(b): decrypt an age-encrypted dump on the host BEFORE touching the DB, so a
  // decryption failure never leaves a scratch DB behind. Plaintext dumps (external
  // drive, or an operator-provided --file) are read as-is. The key material stays
  // in Carlos's hands; the script only reads the identity-file PATH from env.
  const encrypted = dumpIsEncrypted(basename(dumpPath));
  let dumpBytes;
  if (encrypted) {
    const identity = process.env.BACKUP_AGE_IDENTITY_FILE ?? env.BACKUP_AGE_IDENTITY_FILE;
    if (!identity) {
      die(
        'dump is age-encrypted (.dump.age) but BACKUP_AGE_IDENTITY_FILE is not set (or pass a decrypted --file)',
      );
    }
    if (!existsSync(identity)) die(`BACKUP_AGE_IDENTITY_FILE not found: ${identity}`);
    const dec = spawnSync('age', ['-d', '-i', identity, dumpPath], {
      encoding: 'buffer',
      maxBuffer: 512 * 1024 * 1024,
    });
    if (dec.error && dec.error.code === 'ENOENT') {
      die(
        'dump is age-encrypted but the `age` binary is not installed (install it: brew install age)',
      );
    }
    if (dec.status !== 0) {
      const err = dec.stderr ? dec.stderr.toString().trim() : '';
      die(`age decryption failed${err ? `: ${err}` : ''}`);
    }
    dumpBytes = dec.stdout;
  } else {
    dumpBytes = readFileSync(dumpPath);
  }

  // Compose Postgres must be up. Disambiguate if several run (same rule as backup:
  // BACKUP_PG_CONTAINER selects; several without it fails loud). The scratch DB is
  // created and dropped inside whichever container this resolves to.
  const names = listPgContainers();
  let container;
  try {
    container = selectPgContainer(
      names,
      process.env.BACKUP_PG_CONTAINER ?? env.BACKUP_PG_CONTAINER,
    );
  } catch (err) {
    die(err.message);
  }
  if (!container) {
    die('compose Postgres is not running - start it with: docker compose up -d');
  }

  let restoreOk = false;
  try {
    dockerExec(container, ['dropdb', '-U', pgUser, '--if-exists', SCRATCH_DB], {
      encoding: 'utf8',
    });
    const created = dockerExec(container, ['createdb', '-U', pgUser, SCRATCH_DB], {
      encoding: 'utf8',
    });
    if (created.status !== 0) die(`could not create scratch DB: ${(created.stderr ?? '').trim()}`);

    // D12: dump is on the HOST; feed it to the container tool over STDIN. dumpBytes
    // is already-decrypted plaintext on the NC-1(b) branch (age -d ran above).
    const restore = dockerExec(container, ['pg_restore', '-U', pgUser, '-d', SCRATCH_DB], {
      stdin: true,
      input: dumpBytes,
      encoding: 'buffer',
    });
    if (restore.status !== 0) {
      const err = restore.stderr ? restore.stderr.toString().trim() : '';
      throw new Error(`pg_restore failed${err ? `: ${err.split('\n').slice(-3).join(' ')}` : ''}`);
    }
    restoreOk = true;

    const actual = captureCounts(container, pgUser);
    const { ok, diffs } = compareManifest(expected, actual);
    if (!ok) {
      let msg = 'restore VERIFY FAILED - row counts differ from the manifest:';
      for (const d of diffs) msg += `\n  ${d.table}: manifest=${d.expected} restored=${d.actual}`;
      throw new Error(msg);
    }
    process.stdout.write(
      `db-restore-verify: PASS - ${Object.keys(actual).length} table(s) restored, all counts match the manifest\n`,
    );
  } catch (err) {
    dropScratch(container, pgUser);
    die(err.message);
  }
  dropScratch(container, pgUser);
  if (!restoreOk) process.exit(1);
}

function dropScratch(container, pgUser) {
  const res = dockerExec(container, ['dropdb', '-U', pgUser, '--if-exists', SCRATCH_DB], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    process.stderr.write(
      `db-restore-verify: WARN could not drop scratch DB ${SCRATCH_DB} (drop it manually)\n`,
    );
  }
}

// Enumerate BASE TABLES in the scratch DB and count each (value-free).
function captureCounts(container, pgUser) {
  const enumRes = dockerExec(
    container,
    [
      'psql',
      '-U',
      pgUser,
      '-d',
      SCRATCH_DB,
      '-tA',
      '-F',
      '\t',
      '-c',
      "select table_name, table_type from information_schema.tables where table_schema='public'",
    ],
    { encoding: 'utf8' },
  );
  if (enumRes.status !== 0) throw new Error('could not enumerate restored tables');
  const rows = enumRes.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [table_name, table_type] = l.split('\t');
      return { table_name, table_type };
    });
  const tables = filterBaseTables(rows);
  if (tables.length === 0) return {};
  const unionSql = tables
    .map(
      (t) =>
        `select '${t.replace(/'/g, "''")}' as t, count(*) as c from "${t.replace(/"/g, '""')}"`,
    )
    .join(' union all ');
  const countRes = dockerExec(
    container,
    ['psql', '-U', pgUser, '-d', SCRATCH_DB, '-tA', '-F', '\t', '-c', unionSql],
    { encoding: 'utf8' },
  );
  if (countRes.status !== 0) throw new Error('could not count restored rows');
  return parseCountOutput(countRes.stdout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
