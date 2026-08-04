import { type Db } from '../client.ts';

// M13-09 (F-7): the rolled-back-preview seam. A destructive profile import can
// silently delete rows the gitignored docs/profile/ has no history to recover
// (D-4 full-mirror semantics). The guard needs the WOULD-BE delete counts before
// it writes - and the parity law (plan D1) forbids a second, drift-prone diff
// engine. So the preview runs the EXACT execution code path inside a transaction
// that always rolls back: same reads, same upsert/delete logic, same counts, zero
// commit. The single execution body is shared by syncX (commits) and
// previewSyncX (rolls back) so they can never diverge.
//
// This helper is INTERNAL to packages/db (never exported from index.ts): the
// preview methods ride on the EXISTING repository interfaces, so the barrel stays
// the single-writer surface it is for the M13 arc (audit REQUIRED-B).

/** The transaction handle drizzle hands the `db.transaction` callback. Same query
 *  surface as `Db`; typed off `Db` so it tracks the schema automatically. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// A private sentinel: throwing it out of the transaction callback makes drizzle
// ROLL BACK, and we swallow only this class so a real error still propagates.
// (Not drizzle's tx.rollback() - that couples the seam to a provider API; a
// thrown-and-caught sentinel is explicit and provider-agnostic.)
class PreviewRollbackSignal extends Error {
  constructor() {
    super('preview rollback (expected)');
    this.name = 'PreviewRollbackSignal';
  }
}

/**
 * Run `work` inside a transaction, capture its result, then ALWAYS roll back.
 * The work executes the real inserts/updates/deletes (so the counts are exact)
 * and briefly holds the row locks the deletes take - harmless single-user, and
 * nothing is committed (audit N-2). Returns what `work` returned.
 */
export async function runRolledBack<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  let captured: T | undefined;
  let completed = false;
  try {
    await db.transaction(async (tx) => {
      captured = await work(tx);
      completed = true;
      // Unwind the transaction: nothing this preview did is committed.
      throw new PreviewRollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof PreviewRollbackSignal)) throw error;
  }
  // If the sentinel fired, `work` finished and `captured` is set. A non-sentinel
  // path never reaches here (it re-throws above), so this guards only a would-be
  // logic error in this helper, never a swallowed failure.
  if (!completed) throw new Error('rolled-back preview did not complete');
  return captured as T;
}
