import { describe, expect, it } from 'vitest';

import {
  assertNoMigrationDrift,
  checkMigrationDrift,
  describeMigrationDrift,
  MigrationDriftError,
} from './migration-drift.ts';

/** A drizzle-handle stand-in returning a fixed applied-migrations count. */
function dbReturning(count: unknown) {
  return { execute: () => Promise.resolve({ rows: [{ count }] }) };
}
function dbRejecting(message: string) {
  return { execute: () => Promise.reject(new Error(message)) };
}
const journal = (n: number) => () =>
  Promise.resolve(JSON.stringify({ entries: Array.from({ length: n }, (_, idx) => ({ idx })) }));

describe('describeMigrationDrift', () => {
  it('is silent when the counts agree', () => {
    expect(describeMigrationDrift(27, 27)).toBeNull();
  });

  it('names the BEHIND direction, both counts, and the verbatim remedy', () => {
    const message = describeMigrationDrift(26, 27);
    expect(message).toContain('BEHIND');
    expect(message).toContain('26 applied, 27 on disk');
    expect(message).toContain('pnpm db:migrate');
  });

  it('names the AHEAD direction too - an old checkout against a newer DB is drift', () => {
    const message = describeMigrationDrift(28, 27);
    expect(message).toContain('AHEAD');
    expect(message).toContain('28 applied, 27 on disk');
    expect(message).toContain('pnpm db:migrate');
  });

  it('does not confuse the two directions', () => {
    expect(describeMigrationDrift(26, 27)).not.toContain('AHEAD');
    expect(describeMigrationDrift(28, 27)).not.toContain('BEHIND');
  });
});

describe('checkMigrationDrift', () => {
  it('reports current when the database matches the journal', async () => {
    const result = await checkMigrationDrift({
      queryable: dbReturning(27),
      readJournal: journal(27),
    });
    expect(result).toEqual({ status: 'current', applied: 27, onDisk: 27 });
  });

  it('reports drifted, with counts, when the database is behind', async () => {
    const result = await checkMigrationDrift({
      queryable: dbReturning(26),
      readJournal: journal(27),
    });
    expect(result.status).toBe('drifted');
    if (result.status !== 'drifted') return;
    expect(result).toMatchObject({ applied: 26, onDisk: 27 });
    expect(result.message).toContain('BEHIND');
  });

  it('reports drifted when the database is ahead', async () => {
    const result = await checkMigrationDrift({
      queryable: dbReturning(28),
      readJournal: journal(27),
    });
    expect(result.status).toBe('drifted');
  });

  // The indeterminate cases: each must resolve, never throw, so that failing
  // closed on confirmed drift can never turn into crashing a boot.
  it('is indeterminate, not drifted, when the database is unreachable', async () => {
    const result = await checkMigrationDrift({
      queryable: dbRejecting('ECONNREFUSED'),
      readJournal: journal(27),
    });
    expect(result.status).toBe('indeterminate');
  });

  it('is indeterminate when the applied-migrations table does not exist yet', async () => {
    const result = await checkMigrationDrift({
      queryable: dbRejecting('relation "drizzle.__drizzle_migrations" does not exist'),
      readJournal: journal(27),
    });
    expect(result.status).toBe('indeterminate');
  });

  it('is indeterminate when the journal is unreadable or malformed', async () => {
    const unreadable = await checkMigrationDrift({
      queryable: dbReturning(27),
      readJournal: () => Promise.reject(new Error('ENOENT')),
    });
    expect(unreadable.status).toBe('indeterminate');

    const malformed = await checkMigrationDrift({
      queryable: dbReturning(27),
      readJournal: () => Promise.resolve('{"no":"entries"}'),
    });
    expect(malformed.status).toBe('indeterminate');
  });

  it('is indeterminate when the count comes back as a non-number', async () => {
    const result = await checkMigrationDrift({
      queryable: dbReturning('27'),
      readJournal: journal(27),
    });
    expect(result.status).toBe('indeterminate');
  });
});

describe('assertNoMigrationDrift', () => {
  it('throws MigrationDriftError on confirmed drift, carrying the remedy', async () => {
    // This one reads the REAL journal on disk, so ask the database for a count
    // that cannot match it in either direction.
    await expect(
      assertNoMigrationDrift({ nodeEnv: 'development', db: dbReturning(-1), note: () => {} }),
    ).rejects.toThrow(MigrationDriftError);
  });

  it('is inert in test and production, without touching the database', async () => {
    let queried = false;
    const spying = {
      execute: () => {
        queried = true;
        return Promise.resolve({ rows: [{ count: -1 }] });
      },
    };

    for (const nodeEnv of ['test', 'production']) {
      await expect(
        assertNoMigrationDrift({ nodeEnv, db: spying, note: () => {} }),
      ).resolves.toBeUndefined();
    }
    expect(queried).toBe(false);
  });

  it('notes at most one line and does NOT throw when the result is indeterminate', async () => {
    const notes: string[] = [];
    await expect(
      assertNoMigrationDrift({
        nodeEnv: 'development',
        db: dbRejecting('ECONNREFUSED'),
        note: (line) => notes.push(line),
      }),
    ).resolves.toBeUndefined();
    expect(notes).toHaveLength(1);
  });
});
