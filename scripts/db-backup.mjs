// M13-01 backup (F-5, exam "Data you cannot get back"). Produces a dated,
// custom-format pg_dump of the compose Postgres PLUS a tar of docs/profile/,
// with a per-table row-count manifest, to a private destination OUTSIDE the repo
// and off the primary disk. The only copy of the real profile + application data
// is the local pgdata volume + gitignored docs/profile/; ADR-0015 local-first
// makes this THE single point of loss. See docs/RUNBOOKS.md "Backup & restore".
//
// Secret hygiene (D2): every pg tool runs INSIDE the compose container over the
// unix socket (pg_hba `local ... trust` in the official image), so NO password
// is ever read, passed, or printed. The script reads .env only for the NAMES
// POSTGRES_USER / POSTGRES_DB and the BACKUP_* knobs; POSTGRES_PASSWORD is never
// touched. Output is value-free: filenames (dated, no private values), byte
// sizes, table/file counts, and deleted-count only -- never row content, never
// the contents of docs/profile/, never a real destination path beyond BACKUP_DIR.
//
// Destination law (D3): BACKUP_DIR is required; it is realpath-resolved
// (symlink-proof) and HARD-FAILS if it is the repo or any path inside it, and
// fails if it shares a filesystem device with the repo unless BACKUP_SAME_DEVICE_OK=1
// (the honest off-primary-disk acknowledgment).
//
// Atomicity (D4): each artifact is written to <BACKUP_DIR>/.tmp/<name>.part
// (0700 dir, 0600 file), fsync'd, integrity-checked, then renamed into place
// ONLY after its producing command exited 0; any failure removes the partial and
// leaves no final-named file, and retention pruning runs only after a fully
// successful run (a failing run never shrinks the existing safety net).
//
// Encryption (D-B, NC-1(b) cloud branch): when BACKUP_AGE_RECIPIENT is set, BOTH
// the dump AND the profile tar are piped through `age -r <recipient>` inside the
// same temp+rename flow, landing as <name>.dump.age / <name>.tar.age -- the two
// files that actually leave the machine into a cloud-synced folder. The manifest
// stays plaintext deliberately (public table names + integer counts only; a
// readable manifest is what makes restore-verify + drift triage possible without
// touching key material). The private identity that opens the ciphertext is
// Carlos's alone (NC-2): it is never read, printed, or committed here. Leave
// BACKUP_AGE_RECIPIENT unset for the external-drive branch (plaintext artifacts,
// the encrypted volume is the boundary).
//
// Usage: BACKUP_DIR=/Volumes/backup pnpm db:backup   (needs compose Postgres up)

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TS_SHAPE = /^\d{8}-\d{6}$/;

// Profile tar args (shared by the archive + the file-count pass so they never drift):
// exclude macOS Finder cruft (.DS_Store, AppleDouble ._*) so the archive holds only
// real profile files. Excludes must precede the paths for bsdtar.
const PROFILE_TAR_ARGS = [
  '-cf',
  '-',
  '--exclude',
  '.DS_Store',
  '--exclude',
  '._*',
  '-C',
  REPO_ROOT,
  join('docs', 'profile'),
];

// ---------------------------------------------------------------------------
// Pure helpers (D8: exported, docker-free, unit-tested in db-backup.test.mjs).
// ---------------------------------------------------------------------------

// Minimal KEY=VALUE .env parser: skips blank lines and `#` comments, trims, does
// NO expansion, strips one layer of matching surrounding quotes. Values are never
// printed by this script (D2); parsing here only reads names + BACKUP_* knobs.
export function parseDotEnv(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === '') continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// D4 naming: one run = one timestamp across all three artifacts. Local time,
// zero-padded, value-free.
export function formatTimestamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

export function backupFilenames(ts) {
  return {
    dump: `careerforge-db-${ts}.dump`,
    manifest: `careerforge-db-${ts}.manifest.json`,
    profile: `careerforge-profile-${ts}.tar`,
  };
}

// True iff `child` is the same path as `parent` or nested inside it. Both inputs
// must already be realpath-resolved absolute paths (D3 resolves before calling).
export function isInsideOrEqual(child, parent) {
  if (child === parent) return true;
  const base = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(base);
}

// D3: resolve BACKUP_DIR + repo root through realpath (symlink-proof) and reject
// a destination that is, or lives inside, the repository. Throws a named Error.
export function resolveDestination(backupDir, repoRoot, deps = {}) {
  const realpath = deps.realpath ?? realpathSync;
  if (!backupDir || backupDir.trim() === '') {
    throw new Error(
      'BACKUP_DIR is not set - point it at a private directory OUTSIDE the repo (see .env.example)',
    );
  }
  let destReal;
  try {
    destReal = realpath(backupDir);
  } catch {
    throw new Error(`BACKUP_DIR does not exist or is not accessible: ${backupDir}`);
  }
  const repoReal = realpath(repoRoot);
  if (isInsideOrEqual(destReal, repoReal)) {
    throw new Error(
      'BACKUP_DIR resolves inside the repository - backups must live OUTSIDE the repo (D3)',
    );
  }
  return { destReal, repoReal };
}

// D3 off-primary-disk gate: same filesystem device as the repo -> FAIL unless the
// operator has set BACKUP_SAME_DEVICE_OK=1 (documented as "only for a cloud-synced
// folder that leaves the machine"). Throws a named Error when it must fail.
export function assertOffPrimaryDisk(destReal, repoReal, sameDeviceOk, deps = {}) {
  const stat = deps.stat ?? statSync;
  const destDev = stat(destReal).dev;
  const repoDev = stat(repoReal).dev;
  if (destDev === repoDev && !sameDeviceOk) {
    throw new Error(
      'BACKUP_DIR is on the same filesystem device as the repo (primary disk). ' +
        'A same-disk copy does not survive disk failure / a lost laptop. ' +
        'Move it to an external drive, or set BACKUP_SAME_DEVICE_OK=1 ONLY for a cloud-synced folder that leaves the machine (D3).',
    );
  }
}

// D5: enumerate BASE TABLES only (views would count-drift meaninglessly; audit
// N-3). Given rows of { table_name, table_type } from information_schema, keep
// only base tables, sorted. Pure so the filter is unit-tested.
export function filterBaseTables(rows) {
  return rows
    .filter((r) => r.table_type === 'BASE TABLE')
    .map((r) => r.table_name)
    .sort();
}

// Parse `psql -tA -F'\t'` count output ("table<TAB>count" per line) into
// { table: number }. Value-free: table names are public-schema identifiers,
// counts are integers.
export function parseCountOutput(text) {
  const counts = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const table = line.slice(0, tab);
    const n = Number(line.slice(tab + 1).trim());
    if (!Number.isFinite(n)) continue;
    counts[table] = n;
  }
  return counts;
}

// D7 exact-prune matcher: a backup tool MUST never delete a file it did not
// create. Returns the subset of `names` that are managed artifacts (the three
// exact patterns, dated with the D4 timestamp shape, plus the `.age` variants the
// cloud branch mints for the dump and the tar) whose timestamp is strictly older
// than `retentionDays` before `now`. Anything else in the directory is untouchable
// by construction. The manifest never takes `.age` (it stays plaintext), so no
// `.manifest.json.age` is ever managed.
const MANAGED_RE =
  /^careerforge-(?:db-(\d{8}-\d{6})\.(?:dump(?:\.age)?|manifest\.json)|profile-(\d{8}-\d{6})\.tar(?:\.age)?)$/;

export function timestampFromArtifact(name) {
  const m = MANAGED_RE.exec(name);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

// Parse a "YYYYMMDD-HHMMSS" stamp into epoch ms (local time). Returns null if the
// shape does not match.
export function parseStamp(ts) {
  if (!TS_SHAPE.test(ts)) return null;
  const y = Number(ts.slice(0, 4));
  const mo = Number(ts.slice(4, 6));
  const d = Number(ts.slice(6, 8));
  const h = Number(ts.slice(9, 11));
  const mi = Number(ts.slice(11, 13));
  const s = Number(ts.slice(13, 15));
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

export function selectForPruning(names, now, retentionDays) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const doomed = [];
  for (const name of names) {
    const ts = timestampFromArtifact(name);
    if (ts === null) continue; // not ours -> never touch
    const when = parseStamp(ts);
    if (when === null) continue;
    if (when < cutoff) doomed.push(name);
  }
  return doomed;
}

// ---------------------------------------------------------------------------
// Impure runtime (main): docker + fs. Not exercised by CI tests (D8); proven by
// the slice-4 planted-FAIL demos + the operator drill.
// ---------------------------------------------------------------------------

function die(message) {
  process.stderr.write(`db-backup: ${message}\n`);
  process.exit(1);
}

// List running compose Postgres containers by label. Works from any checkout -
// including a git worktree whose compose project name differs from the checkout
// that started the container, so `docker compose ps` from here would find nothing
// (the docker-smoke.mjs precedent). deps.run is injectable for tests.
export function listPgContainers(deps = {}) {
  const run = deps.run ?? ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }));
  const r = run('docker', [
    'ps',
    '--filter',
    'label=com.docker.compose.service=postgres',
    '--format',
    '{{.Names}}',
  ]);
  return ((r && r.stdout) || '')
    .trim()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Choose the target container. During multi-lane worktree dev SEVERAL compose
// Postgres containers run at once; silently picking one could back up the WRONG
// database - unacceptable for a backup tool - so with more than one match we FAIL
// LOUD and ask the operator to disambiguate via BACKUP_PG_CONTAINER. An explicit
// name must be among the running set. Pure so the choice is unit-tested. Returns
// null only when nothing is running (the caller turns that into its own message).
export function selectPgContainer(names, explicit) {
  if (explicit) {
    if (!names.includes(explicit)) {
      throw new Error(
        `BACKUP_PG_CONTAINER=${explicit} is not a running compose Postgres container` +
          ` (running: ${names.length ? names.join(', ') : 'none'})`,
      );
    }
    return explicit;
  }
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  throw new Error(
    `multiple compose Postgres containers are running (${names.join(', ')}); ` +
      `set BACKUP_PG_CONTAINER=<name> to choose which database to back up`,
  );
}

// Run a pg tool INSIDE the discovered container over the unix socket (pg_hba
// `local ... trust` -> no password ever read/passed/printed). `-i` is added when
// input is piped in (D12: the host backup dir is never mounted into compose).
function dockerExec(container, cmd, { stdin = false, ...spawnOpts } = {}) {
  return spawnSync('docker', ['exec', ...(stdin ? ['-i'] : []), container, ...cmd], spawnOpts);
}

// Stream a producer's output into a fresh 0600 temp file under tmpDir; fsync;
// return the temp path (NOT yet named/renamed into the destination). Removes the
// partial and throws if the producer exits non-zero.
function produceToTemp(tmpDir, partName, producer) {
  const partPath = join(tmpDir, partName);
  const fd = openSync(partPath, 'w', 0o600);
  try {
    const result = producer(fd);
    fsyncSync(fd);
    closeSync(fd);
    if (result.status !== 0) {
      rmSync(partPath, { force: true });
      const stderr = result.stderr ? result.stderr.toString().trim() : '';
      throw new Error(`producing ${partName} failed${stderr ? `: ${stderr}` : ''}`);
    }
  } catch (err) {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    rmSync(partPath, { force: true });
    throw err;
  }
  chmodSync(partPath, 0o600);
  return partPath;
}

// D-B / NC-1(b): encrypt srcPath -> outPath with `age -r <recipient>`. The private
// identity that opens this ciphertext lives ONLY in Carlos's hands (NC-2) and is
// never read, printed, or committed here. Removes the partial and throws on any
// failure (including a missing `age` binary).
function ageEncryptFile(srcPath, outPath, recipient) {
  const r = spawnSync('age', ['-r', recipient, '-o', outPath, srcPath], { encoding: 'buffer' });
  if (r.error && r.error.code === 'ENOENT') {
    throw new Error(
      'BACKUP_AGE_RECIPIENT is set but the `age` binary is not installed (install it: brew install age)',
    );
  }
  if (r.status !== 0) {
    rmSync(outPath, { force: true });
    const stderr = r.stderr ? r.stderr.toString().trim() : '';
    throw new Error(`age encryption failed${stderr ? `: ${stderr}` : ''}`);
  }
  chmodSync(outPath, 0o600);
  return outPath;
}

// Land a produced plaintext temp as the final artifact. When a recipient is
// configured (NC-1(b) cloud branch) encrypt it to <baseName>.age and remove the
// plaintext temp (it never existed outside the 0700 .tmp dir); otherwise rename
// <baseName> into place. Atomic (temp+rename), 0600. Returns the final path.
function landArtifact(tmpDir, destDir, partPath, baseName, recipient) {
  if (recipient) {
    const encPart = join(tmpDir, `${baseName}.age.part`);
    ageEncryptFile(partPath, encPart, recipient);
    rmSync(partPath, { force: true });
    const finalPath = join(destDir, `${baseName}.age`);
    renameSync(encPart, finalPath);
    return finalPath;
  }
  chmodSync(partPath, 0o600);
  const finalPath = join(destDir, baseName);
  renameSync(partPath, finalPath);
  return finalPath;
}

function main() {
  // Preflight: .env for names + knobs (values never printed).
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath))
    die('.env not found at repo root (need POSTGRES_USER/POSTGRES_DB names + BACKUP_DIR)');
  let env;
  try {
    env = parseDotEnv(readFileSync(envPath, 'utf8'));
  } catch {
    die('could not read .env');
  }
  const pgUser = process.env.POSTGRES_USER ?? env.POSTGRES_USER;
  const pgDb = process.env.POSTGRES_DB ?? env.POSTGRES_DB;
  if (!pgUser || !pgDb) die('POSTGRES_USER / POSTGRES_DB not found in .env');

  const backupDir = process.env.BACKUP_DIR ?? env.BACKUP_DIR;
  const retentionDays = Number(
    process.env.BACKUP_RETENTION_DAYS ?? env.BACKUP_RETENTION_DAYS ?? 30,
  );
  const sameDeviceOk = (process.env.BACKUP_SAME_DEVICE_OK ?? env.BACKUP_SAME_DEVICE_OK) === '1';

  let dest;
  try {
    dest = resolveDestination(backupDir, REPO_ROOT);
    assertOffPrimaryDisk(dest.destReal, dest.repoReal, sameDeviceOk);
  } catch (err) {
    die(err.message);
  }
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    die('BACKUP_RETENTION_DAYS must be a positive number');
  }

  // D6: docs/profile/ MUST exist (this script protects the real data; a silent
  // skip would fake a complete backup).
  const profileDir = join(REPO_ROOT, 'docs', 'profile');
  if (!existsSync(profileDir)) {
    die(
      'docs/profile/ is missing - refusing to write an incomplete backup (D6). A machine without the real profile has no business running db:backup.',
    );
  }

  // Compose Postgres must be up (never auto-start). Disambiguate if several run.
  const containerNames = listPgContainers();
  let container;
  try {
    container = selectPgContainer(
      containerNames,
      process.env.BACKUP_PG_CONTAINER ?? env.BACKUP_PG_CONTAINER,
    );
  } catch (err) {
    die(err.message);
  }
  if (!container) {
    die('compose Postgres is not running - start it with: docker compose up -d');
  }

  // NC-1(b): a configured recipient turns on in-script age encryption of the two
  // files that leave the machine (D-B). Unset -> plaintext (external-drive branch).
  const recipient = process.env.BACKUP_AGE_RECIPIENT ?? env.BACKUP_AGE_RECIPIENT;

  const ts = formatTimestamp();
  const names = backupFilenames(ts);
  const tmpDir = join(dest.destReal, '.tmp');
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  chmodSync(tmpDir, 0o700);

  const written = [];
  try {
    // --- DB dump (D1): custom format, streamed binary-safe to a temp file. ---
    const dumpPart = produceToTemp(tmpDir, `${names.dump}.part`, (fd) =>
      dockerExec(container, ['pg_dump', '-U', pgUser, '-d', pgDb, '--format=custom'], {
        stdio: ['ignore', fd, 'pipe'],
        encoding: 'buffer',
      }),
    );

    // --- D5 integrity check on the PLAINTEXT dump: pg_restore --list over stdin.
    // Runs BEFORE encryption: backup holds no private key and cannot open its own
    // ciphertext, so the check must see the real dump bytes.
    const listing = dockerExec(container, ['pg_restore', '--list'], {
      stdin: true,
      input: readFileSync(dumpPart),
      encoding: 'buffer',
    });
    if (listing.status !== 0) {
      rmSync(dumpPart, { force: true });
      throw new Error('dump failed its pg_restore --list integrity check');
    }

    // --- Encrypt (NC-1(b)) or land plaintext, atomic rename into place. ---
    const dumpPath = landArtifact(tmpDir, dest.destReal, dumpPart, names.dump, recipient);
    written.push(dumpPath);

    // --- Manifest (D5): BASE-TABLE row counts; PLAINTEXT on either branch. ---
    const manifest = captureManifest(container, pgUser, pgDb, ts);
    const manifestPath = join(dest.destReal, names.manifest);
    const manifestPart = join(tmpDir, `${names.manifest}.part`);
    writeFileSync(manifestPart, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    renameSync(manifestPart, manifestPath);
    written.push(manifestPath);

    // --- Profile tar (D6): tar docs/profile, then encrypt on the cloud branch. ---
    const profilePart = produceToTemp(tmpDir, `${names.profile}.part`, (fd) =>
      spawnSync('tar', PROFILE_TAR_ARGS, {
        stdio: ['ignore', fd, 'pipe'],
        encoding: 'buffer',
      }),
    );
    const profilePath = landArtifact(tmpDir, dest.destReal, profilePart, names.profile, recipient);
    written.push(profilePath);

    // --- Retention prune (D7): only after a fully successful run. ---
    let pruned = 0;
    const existing = readdirSync(dest.destReal);
    for (const name of selectForPruning(existing, Date.now(), retentionDays)) {
      rmSync(join(dest.destReal, name), { force: true });
      pruned += 1;
    }

    // --- Value-free summary. ---
    const tableCount = Object.keys(manifest.tables).length;
    const profileFiles = manifest.profileFileCount;
    process.stdout.write(
      `db-backup: OK\n` +
        `  ${basename(dumpPath)} (${sizeOf(dumpPath)} bytes)\n` +
        `  ${names.manifest} (${tableCount} tables)\n` +
        `  ${basename(profilePath)} (${profileFiles} files, ${sizeOf(profilePath)} bytes)\n` +
        (recipient ? `  encrypted with age (BACKUP_AGE_RECIPIENT set)\n` : '') +
        `  pruned ${pruned} artifact(s) older than ${retentionDays} day(s)\n`,
    );
  } catch (err) {
    // Best-effort cleanup of any partials; final-named artifacts already renamed
    // stay (they passed their own checks). Retention did NOT run on a failure.
    rmSync(tmpDir, { recursive: true, force: true });
    die(err.message);
  }
  rmSync(tmpDir, { recursive: true, force: true });
}

// One psql session: enumerate base tables, then count each, emit TSV.
function captureManifest(container, pgUser, pgDb, ts) {
  const enumRes = dockerExec(
    container,
    [
      'psql',
      '-U',
      pgUser,
      '-d',
      pgDb,
      '-tA',
      '-F',
      '\t',
      '-c',
      "select table_name, table_type from information_schema.tables where table_schema='public'",
    ],
    { encoding: 'utf8' },
  );
  if (enumRes.status !== 0) throw new Error('could not enumerate tables for the manifest');
  const rows = enumRes.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [table_name, table_type] = l.split('\t');
      return { table_name, table_type };
    });
  const tables = filterBaseTables(rows);

  let counts = {};
  if (tables.length > 0) {
    const unionSql = tables
      .map((t) => `select ${sqlLiteral(t)} as t, count(*) as c from "${t.replace(/"/g, '""')}"`)
      .join(' union all ');
    const countRes = dockerExec(
      container,
      ['psql', '-U', pgUser, '-d', pgDb, '-tA', '-F', '\t', '-c', unionSql],
      { encoding: 'utf8' },
    );
    if (countRes.status !== 0) throw new Error('could not count rows for the manifest');
    counts = parseCountOutput(countRes.stdout);
  }

  // Profile file count (value-free: a number). tar listing is never printed.
  const profileTar = spawnSync('tar', PROFILE_TAR_ARGS, {
    encoding: 'buffer',
  });
  let profileFileCount = 0;
  if (profileTar.status === 0) {
    const list = spawnSync('tar', ['-tf', '-'], { input: profileTar.stdout, encoding: 'utf8' });
    profileFileCount = list.stdout.split('\n').filter((l) => l.trim() && !l.endsWith('/')).length;
  }

  return { timestamp: ts, database: 'careerforge (name masked)', tables: counts, profileFileCount };
}

function sqlLiteral(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

function sizeOf(path) {
  return statSync(path).size;
}

// ---------------------------------------------------------------------------
// M13-09 (F-7): --profile-only mode. The import deletion guard takes a
// pre-destructive snapshot of docs/profile/ (the gitignored files it is about to
// mirror-and-delete) by shelling out to THIS script in this mode. It reuses the
// SAME destination law (D3), the SAME temp+rename + age-encrypt seam, and the
// SAME prune-compatible profile-tar name as the full backup (plan D5: one
// implementation) - but skips the DB dump/manifest (no docker), because it is
// snapshotting FILES, not the database. Retention is NOT run here; the scheduled
// full backup owns the sweep and its name matches the prune regex, so these age
// out with everything else.
function mainProfileOnly() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) die('.env not found at repo root (need BACKUP_DIR)');
  let env;
  try {
    env = parseDotEnv(readFileSync(envPath, 'utf8'));
  } catch {
    die('could not read .env');
  }

  const backupDir = process.env.BACKUP_DIR ?? env.BACKUP_DIR;
  const sameDeviceOk = (process.env.BACKUP_SAME_DEVICE_OK ?? env.BACKUP_SAME_DEVICE_OK) === '1';

  // SAME destination law as the full backup (D3): reject an unset or in-repo
  // BACKUP_DIR, and one on the primary disk. The re-owed planted-FAIL lives here.
  let dest;
  try {
    dest = resolveDestination(backupDir, REPO_ROOT);
    assertOffPrimaryDisk(dest.destReal, dest.repoReal, sameDeviceOk);
  } catch (err) {
    die(err.message);
  }

  // D6: docs/profile/ MUST exist - a snapshot that silently skips would fake the
  // safety the guard relies on before it deletes rows.
  const profileDir = join(REPO_ROOT, 'docs', 'profile');
  if (!existsSync(profileDir)) {
    die(
      'docs/profile/ is missing - refusing to write an empty profile snapshot (D6). A machine without the real profile has no business snapshotting it.',
    );
  }

  const recipient = process.env.BACKUP_AGE_RECIPIENT ?? env.BACKUP_AGE_RECIPIENT;
  const ts = formatTimestamp();
  const names = backupFilenames(ts);
  const tmpDir = join(dest.destReal, '.tmp');
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  chmodSync(tmpDir, 0o700);

  try {
    const profilePart = produceToTemp(tmpDir, `${names.profile}.part`, (fd) =>
      spawnSync('tar', PROFILE_TAR_ARGS, { stdio: ['ignore', fd, 'pipe'], encoding: 'buffer' }),
    );
    const profilePath = landArtifact(tmpDir, dest.destReal, profilePart, names.profile, recipient);
    process.stdout.write(
      `db-backup: OK (profile-only snapshot)\n` +
        `  ${basename(profilePath)} (${sizeOf(profilePath)} bytes)\n` +
        (recipient ? `  encrypted with age (BACKUP_AGE_RECIPIENT set)\n` : ''),
    );
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    die(err.message);
  }
  rmSync(tmpDir, { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--profile-only')) mainProfileOnly();
  else main();
}
