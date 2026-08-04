import { spawnSync } from 'node:child_process';
import path from 'node:path';

// M13-09 (F-7): the real pre-destructive snapshot capability wired into the
// import service (deps.snapshotProfile). It shells out to the M13-01 backup
// script in --profile-only mode - ONE implementation of the destination law and
// the temp+rename + age-encrypt seam (plan D5). On any failure it throws; the
// service wraps that into a SnapshotUnavailableError so a destructive import
// fails closed. The script prints value-free messages only (BACKUP_DIR paths /
// counts, never profile content), so surfacing its stderr is safe (RISKS P-01).

/** Returns a snapshotProfile() that runs `node scripts/db-backup.mjs
 *  --profile-only` from `repoRoot`, rejecting if the snapshot could not be
 *  written (unset/in-repo BACKUP_DIR, missing docs/profile/, tar/age failure). */
export function createProfileSnapshot(repoRoot: string): () => Promise<void> {
  const script = path.join(repoRoot, 'scripts', 'db-backup.mjs');
  // spawnSync is synchronous, so this returns a settled Promise rather than an
  // async function (which would have nothing to await).
  return () =>
    new Promise<void>((resolve, reject) => {
      const result = spawnSync('node', [script, '--profile-only'], { encoding: 'utf8' });
      if (result.error) {
        reject(new Error(`could not launch the snapshot script: ${result.error.message}`));
        return;
      }
      if (result.status !== 0) {
        const detail =
          (result.stderr || result.stdout || '').trim() || `exited with ${result.status}`;
        reject(new Error(detail));
        return;
      }
      resolve();
    });
}
