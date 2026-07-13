// API boot entry (run via `pnpm dev`, which loads ../../.env). Env validation
// must be the first thing that happens at boot; M0-04 builds the Fastify
// server on top of the validated `env`. stdout/stderr writes below are
// placeholders until pino arrives with the server skeleton (M0-04).
import { parseEnv, type Env } from './env.ts';

const env: Env = (() => {
  try {
    return parseEnv(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
})();

process.stdout.write(
  `[api] environment valid (NODE_ENV=${env.NODE_ENV}, API_PORT=${String(env.API_PORT)}) — server skeleton lands in M0-04\n`,
);
