// Internal link + asset check for the SHIPPED portfolio build (`.output/public`
// from `pnpm --filter @careerforge-app/portfolio generate`, base `/`,
// byte-identical to what deploy.yml publishes — H-2). Serves the build over http
// and crawls it, failing on ANY broken internal link — including `/_nuxt/*`
// assets (`<script src>` / `<link href>`), anchors, and images.
//
// WHY THIS GATE (M2-03): this is the gate that closes the asset-resolution class
// M2-11 handed to M2-03 — the live site rendered UNSTYLED because a base-prefix
// build emitted `/careerforge/_nuxt/*.css` that 404'd at the apex root.
// assert-prerender.mjs parses no href/src and was blind to exactly that; this
// gate catches it (see the PR's PF-4 blindness demo).
//
// INTERNAL ONLY: external links are SKIPPED, never checked — a flaky third-party
// host must never block a merge (BACKLOG M2-03). Only same-origin (localhost)
// links are verified, so every failure is a real internal 404.
//
// COVERAGE BOUNDARY: crawls from `/` (home) — the single content page today, with
// recursion on, so it follows internal links as pages are added (S3-2). Static
// output only.
//
// Usage: node apps/portfolio/scripts/link-check.mjs
import { check, LinkState } from 'linkinator';

const serverRoot = new URL('../.output/public/', import.meta.url).pathname;

const results = await check({
  path: 'index.html',
  serverRoot,
  recurse: true,
  // Skip anything that is not same-origin (the linkinator server runs on
  // localhost/127.0.0.1). External flakiness must never block merge.
  linksToSkip: ['^https?:\\/\\/(?!localhost|127\\.0\\.0\\.1)'],
});

const broken = results.links.filter((l) => l.state === LinkState.BROKEN);
const skipped = results.links.filter((l) => l.state === LinkState.SKIPPED);
const checked = results.links.filter((l) => l.state === LinkState.OK);

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
