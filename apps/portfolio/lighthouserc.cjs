// Lighthouse CI budgets for the portfolio (M2-03, ADR-0009). Audits the SHIPPED
// build — `.output/public` from `pnpm --filter @careerforge-app/portfolio
// generate` (base `/`), the byte-identical output deploy.yml publishes (H-2).
//
// SERVER: LHCI's built-in `staticDistDir` server, NOT a hand-rolled one. It
// serves the built files with gzip, mirroring GitHub Pages — a naive
// no-compression server scored perf 94 under Lighthouse's simulated throttling
// (transfer size dominates), misrepresenting the ~98 the compressed production
// origin actually earns. Cost: it audits every emitted .html (index/200/404 ×
// numberOfRuns = 9 runs); only `/` is asserted (assertMatrix below).
//
// COVERAGE BOUNDARY (a gate must not claim more than it delivers):
//   • Budgets assert `.*/index\.html$` — home AND every case-study page
//     (/case-studies/<slug>/index.html), which match the same pattern, so new
//     studies are asserted automatically (S3-2). Observed exit 0: the content
//     pages meet accessibility=100 / perf≥95 / bp≥95 / seo≥95.
//   • `maxAutodiscoverUrls: 0` (below) is LOAD-BEARING. LHCI's staticDistDir
//     auto-discovery defaults to a cap of 5 URLs (@lhci/cli collect.js) and
//     `.slice(0, 5)`s the rest — with 200.html + 404.html + index.html + N case
//     studies that SILENTLY drops studies from the audit (observed: 5 of 6 pages,
//     one study dropped). Setting the cap to 0 disables it so ALL emitted pages
//     are collected; without it the gate would pass on unaudited pages as more
//     studies land. The Nuxt SPA fallbacks 200.html / 404.html are still audited
//     but NOT asserted (they don't match the pattern; minimal shells, out of scope).
//   • Categories only. Response-header audits (CSP/HSTS/clickjacking) are all
//     Lighthouse weight-0, so the no-custom-headers constraint (ADR-0008) cannot
//     move any weighted score — verified on the real page.
//   • Lab, not field; localhost, not the HTTP-only production origin. `is-on-https`
//     PASSES on http://localhost:<port> (verified across 3 runs) — the CI score
//     is not the live site's HTTPS posture (Enforce HTTPS is operator-owned).
//   • Duplicate-<h1> is NOT a Lighthouse audit — assert-prerender.mjs covers it.
//
// Budgets (measured reachable on the real build, median of 3):
//   performance ≥95 (observed 98; ~3pt local headroom, CI noisier → numberOfRuns 3, median)
//   accessibility =100 (observed 100; STRICT tripwire — any a11y regression blocks)
//   best-practices ≥95 (observed 100 post-favicon; ~+5 cushion → catches ~2-audit regressions)
//   seo ≥95 (observed 100; robots.txt not-applicable when absent, no sitemap audit exists — R-4)
//
// Chrome: chrome-launcher reads CHROME_PATH (CI sets it to the Playwright
// chromium also used by the axe gate; local runs export it too).
module.exports = {
  ci: {
    collect: {
      staticDistDir: '.output/public',
      numberOfRuns: 3,
      // Disable the default 5-URL auto-discovery cap so every emitted page
      // (home + all case studies) is collected, never silently truncated (S3-2).
      maxAutodiscoverUrls: 0,
      settings: { chromeFlags: '--headless=new --no-sandbox' },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: '.*/index\\.html$',
          assertions: {
            'categories:performance': ['error', { minScore: 0.95 }],
            'categories:accessibility': ['error', { minScore: 1 }],
            'categories:best-practices': ['error', { minScore: 0.95 }],
            'categories:seo': ['error', { minScore: 0.95 }],
          },
        },
      ],
    },
    upload: { target: 'filesystem', outputDir: './.lighthouseci' },
  },
};
