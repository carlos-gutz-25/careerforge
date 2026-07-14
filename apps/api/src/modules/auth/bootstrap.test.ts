// Integration tests for first-boot user seeding. Credentials are fictional —
// the real env user never appears in any test (ADR-0007).
import { type FastifyBaseLogger } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUsersRepository } from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { ensureBootstrapUser } from './bootstrap.ts';
import { passwords } from './passwords.ts';

const handle = createTestDb();
const users = createUsersRepository(handle.db);

const ENV = {
  AUTH_BOOTSTRAP_EMAIL: 'env.bootstrap.fictional@example.com',
  AUTH_BOOTSTRAP_PASSWORD: 'fictional-bootstrap-password',
};

// Captures every argument passed to any log method, so the no-password
// assertion covers exactly what would have reached pino.
function createCapturingLogger() {
  const entries: unknown[] = [];
  const capture = (...args: unknown[]) => {
    entries.push(args);
  };
  const logger = {
    level: 'info',
    silent: capture,
    fatal: capture,
    error: capture,
    warn: capture,
    info: capture,
    debug: capture,
    trace: capture,
    child: () => logger,
  } as unknown as FastifyBaseLogger;
  return { logger, entries };
}

beforeEach(async () => {
  await truncateAllTables(handle);
});
afterAll(async () => {
  await handle.pool.end();
});

describe('ensureBootstrapUser', () => {
  it('creates the user at first boot with a working argon2id hash', async () => {
    const { logger } = createCapturingLogger();
    const created = await ensureBootstrapUser({ users, passwords, env: ENV, log: logger });

    expect(created.email).toBe(ENV.AUTH_BOOTSTRAP_EMAIL);
    expect(await passwords.verifyPassword(created.passwordHash, ENV.AUTH_BOOTSTRAP_PASSWORD)).toBe(
      true,
    );
  });

  it('is idempotent: later boots reuse the user and say env password changes are ignored', async () => {
    const { logger, entries } = createCapturingLogger();
    const first = await ensureBootstrapUser({ users, passwords, env: ENV, log: logger });
    const second = await ensureBootstrapUser({
      users,
      passwords,
      env: { ...ENV, AUTH_BOOTSTRAP_PASSWORD: 'a-changed-env-password' },
      log: logger,
    });

    expect(second.id).toBe(first.id);
    // The original password still verifies — env changes do NOT update it.
    expect(await passwords.verifyPassword(second.passwordHash, ENV.AUTH_BOOTSTRAP_PASSWORD)).toBe(
      true,
    );
    expect(JSON.stringify(entries)).toContain('do NOT update');
  });

  it('never logs the password', async () => {
    const { logger, entries } = createCapturingLogger();
    await ensureBootstrapUser({ users, passwords, env: ENV, log: logger });
    await ensureBootstrapUser({ users, passwords, env: ENV, log: logger });

    const logged = JSON.stringify(entries);
    expect(logged).not.toContain(ENV.AUTH_BOOTSTRAP_PASSWORD);
  });
});
