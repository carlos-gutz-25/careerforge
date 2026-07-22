// Internal link + asset check for the SHIPPED portfolio build (`.output/public`
// from `pnpm --filter @careerforge-app/portfolio generate`, base `/`,
// byte-identical to what deploy.yml publishes — H-2). Serves the build over http
// and crawls it, failing on ANY broken internal link — including `/_nuxt/*`
// assets (`<script src>` / `<link href>`), anchors, and images.
//
// WHY THIS GATE (M2-03): closes the asset-resolution class M2-11 handed to
// M2-03 — the live site rendered UNSTYLED because a base-prefix build emitted
// `/careerforge/_nuxt/*.css` that 404'd at the apex root. assert-prerender.mjs
// parses no href/src and was blind to exactly that; this gate catches it (see
// the PR's PF-4 blindness demo).
//
// Serves the build with our own http server (same pattern as axe-check.mjs) and
// crawls a real http URL, so the crawl base is an explicit origin, same-origin
// skipping is exact (by port), and the built bytes are served verbatim with NO
// SPA fallback — a missing asset 404s exactly as it would on GitHub Pages.
//
// SCOPE vs `nuxt generate` (verified this slice — states honest coverage): the
// build step already catches the failure modes it can SEE at build time — a dead
// internal page-anchor fails Nitro's prerender crawl ("Exiting due to prerender
// errors"), and a missing component asset (`<img src>`/import) fails Vite's
// build-time resolution ("Rollup failed to resolve import"). This gate's UNIQUE
// coverage is the asset-PATH class those miss: assets that EXIST but are
// referenced at a path that 404s when served (the M2-11 base-prefix bug that
// shipped an unstyled site) — see the PR's PF-4 + assert-prerender blindness.
//
// INTERNAL ONLY: external links are SKIPPED, never checked — a flaky third-party
// host must never block a merge (BACKLOG M2-03). Only same-origin links are
// verified, so every failure is a real internal 404.
//
// COVERAGE BOUNDARY: crawls from `/` (home) with recursion ON, so it now follows
// the home links into every case-study page and checks their internal links +
// assets too — multi-page coverage comes for free from recursion (S3-2 needs no
// code change here; verified the /case-studies/<slug>/ URLs appear in the crawl).
// Static output only.
//
// Usage: node apps/portfolio/scripts/link-check.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { check, LinkState } from 'linkinator';

const root = new URL('../.output/public/', import.meta.url).pathname;
const port = Number(process.env.LINK_CHECK_PORT ?? 4323);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Serves the built bytes exactly — no SPA fallback — so a missing asset 404s
// just as it would on GitHub Pages (the asset-resolution class this gate exists
// for).
const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = normalize(path.endsWith('/') ? `${path}index.html` : path).replace(
    /^(\.\.[/\\])+/,
    '',
  );
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

await new Promise((resolve) => server.listen(port, resolve));

try {
  const results = await check({
    path: `http://localhost:${port}/`,
    recurse: true,
    // Skip anything not same-origin — external flakiness must never block merge.
    linksToSkip: [`^(?!http://localhost:${port}/)`],
  });

  const broken = results.links.filter((l) => l.state === LinkState.BROKEN);
  const checked = results.links.filter((l) => l.state === LinkState.OK);
  const skipped = results.links.filter((l) => l.state === LinkState.SKIPPED);

  console.log(
    `link-check: ${results.links.length} link(s) — ${checked.length} OK, ${broken.length} broken, ${skipped.length} external skipped`,
  );

  if (broken.length > 0) {
    console.error(`link-check: ${broken.length} broken internal link(s):`);
    for (const link of broken) {
      console.error(
        `  ✘ ${link.status ?? '???'}  ${link.url}${link.parent ? `  (in ${link.parent})` : ''}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log('link-check: 0 broken internal links');
  }
} finally {
  server.close();
}
