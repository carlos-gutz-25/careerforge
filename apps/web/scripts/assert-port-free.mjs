#!/usr/bin/env node
// Dev-server port preflight. Nuxt's dev server (listhen → get-port-please)
// exposes NO strict-port option: when the port is taken it silently picks
// another one, the browser origin stops matching the API's exact-match
// WEB_APP_ORIGIN (CORS allowlist + CSRF origin check), and every mutation
// 403s undiagnosably — the M0-10 squatter finding. This script makes that
// failure loud instead: taken port = refuse to start.
//
// The port arrives as argv from the `dev` script (package.json) and must stay
// in lockstep with `devServer.port` in nuxt.config.ts and WEB_APP_ORIGIN in
// the API env (.env.example documents the pairing).
import net from 'node:net';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`assert-port-free: expected a port number argument, got "${process.argv[2]}"`);
  process.exit(1);
}

const server = net.createServer();
server.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      [
        `assert-port-free: port ${port} is already in use — refusing to start the dev server.`,
        '',
        `Nuxt would silently pick another port, the browser origin would no longer match the`,
        `API's WEB_APP_ORIGIN (exact-match CORS + CSRF), and every mutation would 403.`,
        '',
        `Either free port ${port}, or change devServer.port (nuxt.config.ts), this script's`,
        `argument (package.json dev script), and WEB_APP_ORIGIN (.env) TOGETHER.`,
      ].join('\n'),
    );
  } else {
    console.error(`assert-port-free: could not probe port ${port}: ${error.message}`);
  }
  process.exit(1);
});
server.listen(port, () => {
  server.close(() => process.exit(0));
});
