// M10-02 local container smoke (committed, repeatable, LOCAL-ONLY -- not wired
// into CI, which has no Docker guarantee; that gap is named in the README and
// closed by the M10-06 runbook). Builds the demo image, runs it against the
// compose Postgres on a scratch database with THROWAWAY credentials, and asserts
// the same-origin serve + the image's privacy/no-Nitro invariants end to end.
//
// Secret hygiene: the compose Postgres password is read from the root .env by
// the running process (never by a shell) and is passed to `docker run` via
// name-only `-e DATABASE_URL` (docker copies the value from this process's
// environment, so it never appears in argv / `ps`). Throwaway bootstrap creds
// are random and never printed. All artifacts are torn down in `finally`.
//
// Usage: node scripts/docker-smoke.mjs   (from the repo root; needs compose PG up)

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = 'careerforge-demo:smoke';
const SCRATCH_DB = 'careerforge_docker_smoke';
const COMPOSE_NETWORK = 'careerforge_default';

// --- tiny assertion harness (counts/statuses only, never secrets) -----------
let passed = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function die(message) {
  console.error(`docker-smoke: ${message}`);
  process.exit(2);
}

async function poll(url, { timeoutMs = 60_000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await globalThis.fetch(url);
      if (res.status === 200) return true;
    } catch {
      /* not up yet */
    }
    await sleep(intervalMs);
  }
  return false;
}

// --- resolve compose Postgres connection from .env (never printed) ----------
if (existsSync(join(REPO_ROOT, '.env'))) {
  try {
    process.loadEnvFile(join(REPO_ROOT, '.env'));
  } catch {
    /* fall back to ambient env */
  }
}
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) die('DATABASE_URL not set (need the compose Postgres creds from .env)');
let dbUser;
let dbPassword;
try {
  const u = new URL(baseUrl);
  dbUser = decodeURIComponent(u.username);
  dbPassword = decodeURIComponent(u.password);
} catch {
  die('DATABASE_URL is not a valid URL');
}

// Discover the compose Postgres container (fail fast if it is down).
const pgContainer = sh('docker', [
  'ps',
  '--filter',
  'label=com.docker.compose.service=postgres',
  '--format',
  '{{.Names}}',
])
  .stdout.trim()
  .split('\n')[0];
if (!pgContainer) die('compose Postgres is not running -- run: docker compose up -d');

function psql(sql, db = 'postgres') {
  // Local unix-socket connection inside the container -> pg_hba `local ... trust`,
  // so no password crosses the wire and none is printed.
  return sh('docker', ['exec', pgContainer, 'psql', '-U', dbUser, '-d', db, '-tAc', sql]);
}
const preflight = psql('select 1');
if (preflight.status !== 0) die(`cannot reach compose Postgres: ${preflight.stderr.trim()}`);

// --- throwaway identifiers --------------------------------------------------
const nonce = randomBytes(4).toString('hex');
const containerName = `careerforge-smoke-${nonce}`;
const hostPort = 14300 + (randomBytes(1)[0] % 400); // 14300-14699
const origin = `http://localhost:${hostPort}`;
const bootstrapEmail = `smoke+${nonce}@example.test`;
const bootstrapPassword = randomBytes(18).toString('base64url'); // >= 24 chars, never printed
// The container reaches Postgres over the compose network by service name.
const containerDbUrl = `postgres://${dbUser}:${encodeURIComponent(dbPassword)}@postgres:5432/${SCRATCH_DB}`;

function teardown() {
  sh('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
  psql(`drop database if exists ${SCRATCH_DB} with (force)`);
}

async function main() {
  // 1. Build the image.
  console.log('docker-smoke: building image ...');
  const build = sh('docker', ['build', '-t', IMAGE, '.'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (build.status !== 0) die('image build failed');

  // 2. Fresh scratch database.
  psql(`drop database if exists ${SCRATCH_DB} with (force)`);
  const created = psql(`create database ${SCRATCH_DB}`);
  if (created.status !== 0) die(`could not create scratch DB: ${created.stderr.trim()}`);

  // 3. Run the container (secrets via name-only -e, copied from this env).
  console.log('docker-smoke: starting container ...');
  const run = sh(
    'docker',
    [
      'run',
      '-d',
      '--name',
      containerName,
      '--network',
      COMPOSE_NETWORK,
      '-p',
      `${hostPort}:4301`,
      '-e',
      'DATABASE_URL',
      '-e',
      'AUTH_BOOTSTRAP_EMAIL',
      '-e',
      'AUTH_BOOTSTRAP_PASSWORD',
      '-e',
      `WEB_APP_ORIGIN=${origin}`,
      IMAGE,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: containerDbUrl,
        AUTH_BOOTSTRAP_EMAIL: bootstrapEmail,
        AUTH_BOOTSTRAP_PASSWORD: bootstrapPassword,
      },
    },
  );
  if (run.status !== 0) die(`container failed to start: ${run.stderr.trim()}`);

  // 4. Poll /health (proves migrate-then-boot ran end to end).
  const healthy = await poll(`${origin}/health`);
  if (!healthy) {
    console.error('docker-smoke: /health never came up. Container logs:');
    console.error(sh('docker', ['logs', '--tail', '40', containerName]).stderr);
    die('boot timed out');
  }
  check('GET /health = 200 (migrate-then-boot)', true);

  // 5. HTTP assertions ------------------------------------------------------
  // A browser navigating to `/` sends Accept: text/html -> the SPA short-circuit
  // serves the generated shell. (A non-navigation `GET /` with `*/*` is not a
  // real client and falls through to @fastify/static's directory handling.)
  const root = await globalThis.fetch(`${origin}/`, { headers: { accept: 'text/html' } });
  const rootBody = await root.text();
  check(
    'GET / (navigation) = 200 text/html (generated SPA shell survived containerization)',
    root.status === 200 && (root.headers.get('content-type') ?? '').includes('text/html'),
    `status=${root.status} ct=${root.headers.get('content-type')}`,
  );
  check(
    'served shell bakes same-origin apiBase:"" (Leg G survived containerization)',
    rootBody.includes('apiBase:""'),
    'apiBase:"" not found in served shell',
  );

  const assetMatch = rootBody.match(/\/_nuxt\/[A-Za-z0-9._-]+\.(?:js|css)/);
  if (assetMatch) {
    const asset = await globalThis.fetch(`${origin}${assetMatch[0]}`);
    check(
      'GET /_nuxt/<asset> = 200 + immutable cache',
      asset.status === 200 && (asset.headers.get('cache-control') ?? '').includes('immutable'),
      `status=${asset.status} cc=${asset.headers.get('cache-control')}`,
    );
  } else {
    check('GET /_nuxt/<asset> = 200 + immutable cache', false, 'no /_nuxt/ asset found in shell');
  }

  const json404 = await globalThis.fetch(`${origin}/nonexistent-${nonce}`, {
    headers: { accept: 'application/json' },
  });
  const json404ct = json404.headers.get('content-type') ?? '';
  let json404Envelope = false;
  try {
    json404Envelope = typeof (await json404.json())?.error?.code === 'string';
  } catch {
    /* not JSON */
  }
  check(
    'GET /nonexistent Accept: application/json = 404 JSON envelope (API contract intact)',
    json404.status === 404 && json404ct.includes('application/json') && json404Envelope,
    `status=${json404.status} ct=${json404ct}`,
  );

  const spaDeep = await globalThis.fetch(`${origin}/postings/123`, {
    headers: { accept: 'text/html' },
  });
  check(
    'GET /postings/123 Accept: text/html = 200 SPA shell (deep-link navigation)',
    spaDeep.status === 200 && (spaDeep.headers.get('content-type') ?? '').includes('text/html'),
    `status=${spaDeep.status} ct=${spaDeep.headers.get('content-type')}`,
  );

  const meUnauth = await globalThis.fetch(`${origin}/auth/me`, {
    headers: { accept: 'application/json' },
  });
  check(
    'GET /auth/me unauthenticated = 401 (guard active)',
    meUnauth.status === 401,
    `status=${meUnauth.status}`,
  );

  const login = await globalThis.fetch(`${origin}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  const setCookie = login.headers.get('set-cookie') ?? '';
  const sessionCookie = setCookie.split(';')[0];
  check(
    'POST /auth/login (throwaway creds) = 200 + session cookie',
    login.status === 200 && sessionCookie.length > 0,
    `status=${login.status}`,
  );

  const meAuthed = await globalThis.fetch(`${origin}/auth/me`, {
    headers: { accept: 'application/json', cookie: sessionCookie },
  });
  check('GET /auth/me with session = 200', meAuthed.status === 200, `status=${meAuthed.status}`);

  // 6. Image invariants (privacy boundary + no-Nitro wall) ------------------
  const inspect = sh('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    IMAGE,
    '-c',
    [
      'test ! -e /app/.env && echo NOENV || echo HASENV',
      'test ! -e /app/docs && echo NODOCS || echo HASDOCS',
      'if find / -type d -name nuxt 2>/dev/null | grep -q .; then echo HASNUXT; else echo NONUXT; fi',
      'if find / -type d -path "*.output/server" 2>/dev/null | grep -q .; then echo HASNITRO; else echo NONITRO; fi',
      'if grep -rl "localhost:4301" /app/web-dist 2>/dev/null | grep -q .; then echo HASORIGIN; else echo NOORIGIN; fi',
    ].join('; '),
  ]).stdout;
  check('image carries no /app/.env (privacy boundary)', inspect.includes('NOENV'));
  check('image carries no /app/docs (privacy boundary)', inspect.includes('NODOCS'));
  check('image carries no nuxt tree', inspect.includes('NONUXT'));
  check('image carries no .output/server (no-Nitro wall)', inspect.includes('NONITRO'));
  check('shipped SPA dist carries no absolute API origin', inspect.includes('NOORIGIN'));

  // The .dockerignore privacy boundary governs the BUILD CONTEXT, so it is
  // asserted where `COPY . .` happens (the web-build stage) -- neutering the
  // docs/ deny surfaces here even though the runtime stage's selective COPY is
  // a second, independent guard (defense in depth). This is the committed home
  // of planted-FAIL D10-ii.
  const stageTag = `careerforge-smoke-webbuild:${nonce}`;
  const stageBuild = sh('docker', ['build', '--target', 'web-build', '-t', stageTag, '.'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  if (stageBuild.status === 0) {
    const ctx = sh('docker', [
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      stageTag,
      '-c',
      'test ! -e /app/docs && echo NODOCS || echo HASDOCS; test ! -e /app/.env && echo NOENV || echo HASENV',
    ]).stdout;
    sh('docker', ['rmi', '-f', stageTag], { stdio: 'ignore' });
    check(
      'build context excludes docs/ (.dockerignore privacy boundary)',
      ctx.includes('NODOCS'),
      'docs/ reached the build context',
    );
    check(
      'build context excludes .env (.dockerignore privacy boundary)',
      ctx.includes('NOENV'),
      '.env reached the build context',
    );
  } else {
    check(
      'build context excludes docs/ (.dockerignore privacy boundary)',
      false,
      'web-build stage build failed',
    );
  }
}

try {
  await main();
} catch (err) {
  console.error(`docker-smoke: unexpected error: ${err instanceof Error ? err.message : err}`);
  failures.push('unexpected error');
} finally {
  teardown();
}

console.log(`\ndocker-smoke: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(`failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('docker-smoke: PASS');
