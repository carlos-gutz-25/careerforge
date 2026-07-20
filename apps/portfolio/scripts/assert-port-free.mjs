#!/usr/bin/env node
// Dev-server port preflight (mirrors apps/web/scripts/assert-port-free.mjs).
// Nuxt's dev server (listhen → get-port-please) exposes NO strict-port option:
// when the port is taken it silently picks another one (the M0-10 finding).
// For the portfolio there is no origin-security consequence (no API/CORS/CSRF),
// but a silently re-ported dev server is still a confusing footgun — this makes
// it a loud failure instead: taken port = refuse to start.
//
// The port arrives as argv from the `dev` script (package.json) and must stay
// in lockstep with `devServer.port` in nuxt.config.ts.
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
        `Nuxt would silently pick another port. Either free port ${port}, or change`,
        `devServer.port (nuxt.config.ts) and this script's argument (package.json dev`,
        `script) TOGETHER.`,
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
