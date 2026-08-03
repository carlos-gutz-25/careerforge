import { type DbHandle } from './client.ts';

/**
 * Database readiness for the M13-04 `/health/ready` probe. Runs a single
 * `SELECT 1` through the existing pool, raced against a timeout. Resolves
 * `true` when the round-trip succeeds in time, `false` on ANY error or
 * timeout. It NEVER throws and NEVER surfaces error detail: the caller
 * returns a sanitized 503 body, so no connection string, host, or driver
 * message can reach the wire. SQL lives here (the module-boundary law:
 * no SQL outside packages/db); the API route only sees a boolean.
 */
export async function checkDbReady(handle: DbHandle, timeoutMs = 800): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  // .then/.catch fold the query into a boolean so a late rejection (after the
  // timeout already won the race) can never become an unhandled rejection.
  const ping = handle.pool
    .query('select 1')
    .then(() => true)
    .catch(() => false);
  const ready = await Promise.race([ping, timeout]);
  clearTimeout(timer);
  return ready;
}
