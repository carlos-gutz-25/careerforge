// Full axe-core accessibility gate for the SHIPPED portfolio build
// (`.output/public` from `pnpm --filter @careerforge-app/portfolio generate`,
// base `/`, byte-identical to what deploy.yml publishes — H-2). Runs the
// complete @axe-core/playwright default ruleset (WCAG 2.0/2.1 A + AA +
// best-practice) against `/` and exits non-zero on ANY violation.
//
// WHY FULL axe, not Lighthouse's embedded subset (M2-03 fork 2 / R-1):
// Lighthouse's a11y category (63 audits in core/config/default-config.js) omits
// rules full axe-core ships — e.g. `scrollable-region-focusable` (this gate's
// PF-A2) and `region`, both verified ABSENT from that list — so the BACKLOG
// criterion "axe automated checks with zero violations" is only honest with the
// full engine. Blindness demo (PR #37): a scrollable-region-focusable defect
// makes axe exit 1 while the Lighthouse a11y budget stays 100. (`page-has-heading-one`
// is also axe-only, but assert-prerender.mjs already gates the h1 count, so it is
// NOT part of the delta this gate adds.) Runs ALONGSIDE the Lighthouse budgets.
//
// COVERAGE BOUNDARY: audits `/` (home) AND every generated case-study page
// (/case-studies/<slug>/), derived from the build so all studies are covered
// without hardcoding (S3-2 discharged for axe). Static prerendered DOM only — no
// interaction states. Automated axe finds a well-known FRACTION of WCAG issues;
// a green run is a floor, not a proof of accessibility.
//
// BROWSER: launches the ALREADY-CACHED Playwright chromium via CHROME_PATH — no
// new browser is acquired (the axe package is pure JS; the repo's allowBuilds:
// false blocks any browser download). CHROME_PATH is required.
//
// Serves the build over http (not file://) so root-absolute asset URLs
// (`/_nuxt/*.css`) resolve — axe needs computed styles for colour-contrast.
//
// Usage: CHROME_PATH=<chromium> node apps/portfolio/scripts/axe-check.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { chromium } from 'playwright-core';
import { AxeBuilder } from '@axe-core/playwright';

const root = new URL('../.output/public/', import.meta.url).pathname;
const port = Number(process.env.AXE_PORT ?? 4322);
const executablePath = process.env.CHROME_PATH;

if (!executablePath) {
  console.error('axe-check: CHROME_PATH is required (path to the Playwright chromium binary).');
  process.exit(2);
}

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

const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  // @axe-core/playwright requires a page from an explicit context (it injects
  // init scripts), not browser.newPage().
  // URL list: home + the top-level about/resume pages (M2-08) + every generated
  // case-study page (S3-2, derived from the build so new studies are covered
  // automatically). about/resume are NOT under case-studies/, so unlike the
  // studies they must be listed explicitly — the "zero axe violations" claim is
  // only honest if these pages are actually audited (PF: an a11y defect planted
  // on /about/ makes this gate exit 1).
  const paths = ['/', '/about/', '/resume/'];
  const csDir = join(root, 'case-studies');
  if (existsSync(csDir)) {
    for (const entry of readdirSync(csDir)) {
      if (existsSync(join(csDir, entry, 'index.html'))) paths.push(`/case-studies/${entry}/`);
    }
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  for (const urlPath of paths) {
    const response = await page.goto(`http://localhost:${port}${urlPath}`, {
      waitUntil: 'networkidle',
    });
    if (!response || !response.ok()) {
      throw new Error(
        `page load failed for ${urlPath}: HTTP ${response ? response.status() : 'no response'}`,
      );
    }

    const { violations } = await new AxeBuilder({ page }).analyze();

    if (violations.length > 0) {
      const count = violations.reduce((n, v) => n + v.nodes.length, 0);
      console.error(`axe: ${violations.length} rule violation(s), ${count} node(s) on ${urlPath}:`);
      for (const rule of violations) {
        console.error(`  ✘ [${rule.impact ?? 'n/a'}] ${rule.id} — ${rule.help}`);
        for (const node of rule.nodes) console.error(`      ${node.target.join(' ')}`);
      }
      process.exitCode = 1;
    } else {
      console.log(`axe: 0 violations on ${urlPath} (WCAG 2.0/2.1 A+AA + best-practice)`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
