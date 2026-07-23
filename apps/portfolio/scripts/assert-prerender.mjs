// Asserts the PRERENDERED top-level pages (real `nuxt generate` output) carry
// the accessible-foundation structure. The duplicate-h1 defect and the
// lang/title head exist ONLY in generate output (in unit tests `page` is null
// and ContentRenderer is off), so this gate runs against that output in CI
// (portfolio-build, after `generate`). Structural HTML only — this is NOT an
// a11y auditor; axe/Lighthouse budgets are M2-03.
//
// M2-08: generalized from home-only to every top-level page (home, about,
// resume). Each page argument is `path[::exactTitle]`:
//   • path        — the generated index.html to check.
//   • ::exactTitle — optional. When present, <title> must equal it EXACTLY
//                    (home pins "Carlos Gutierrez · Senior Software Engineer";
//                    about/resume pin their own "<Page> · CareerForge"). When
//                    absent, <title> need only be non-empty. This is the ONLY
//                    gate that guarantees a single <h1> on the pages collection
//                    (about/resume have no R4-style body-h1 check), so a stray
//                    `#` in the markdown body is caught here — demonstrated by
//                    planting a second <h1> on /about/ and running the CI command.
//
// M2-09: also asserts the OpenGraph / Twitter / canonical head per page. og:title
// must MIRROR the exact <title>; og:url and the canonical <link> are absolute and
// trailing-slash normalized and MUST equal the page's own served URL (derived
// from the generated file path) — a mismatch declares a foreign canonical. The
// planted-FAIL for this leg is a wrong-origin / missing-trailing-slash og:url (a
// presence-only plant would leave the correctness regex unproven).
//
// Usage:
//   node apps/portfolio/scripts/assert-prerender.mjs \
//     .output/public/index.html::'Carlos Gutierrez · Senior Software Engineer' \
//     .output/public/about/index.html::'About · CareerForge' \
//     .output/public/resume/index.html::'Resume · CareerForge'
import { readFileSync } from 'node:fs';

// The published apex, used to build each page's expected absolute og:url/canonical.
// BREADCRUMB: this origin is ALSO hardcoded in app/composables/useSeo.ts and
// scripts/assert-provenance.mjs. A domain change is a deliberate multi-file event
// (ADR-0008, M2-11 cutover precedent) — move all three together.
const SITE_ORIGIN = 'https://carlosgutz.com';

// Default to the home page (backward compatible) when no args are given.
const args = process.argv.slice(2);
const specs =
  args.length > 0
    ? args
    : ['.output/public/index.html::Carlos Gutierrez · Senior Software Engineer'];

const failures = [];

for (const spec of specs) {
  const sep = spec.indexOf('::');
  const file = sep >= 0 ? spec.slice(0, sep) : spec;
  const expectedTitle = sep >= 0 ? spec.slice(sep + 2) : null;
  const html = readFileSync(file, 'utf8');
  const check = (ok, message) => {
    if (!ok) failures.push(`${file}: ${message}`);
  };

  const h1s = html.match(/<h1[ >]/g) ?? [];
  check(h1s.length === 1, `expected exactly one <h1>, found ${h1s.length}`);

  const mains = html.match(/<main[ >]/g) ?? [];
  check(mains.length === 1, `expected exactly one <main>, found ${mains.length}`);
  check(/<main[^>]*\bid="main"/.test(html), 'missing <main id="main">');

  check(/<html[^>]*\blang="en"/.test(html), 'missing <html lang="en">');

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  check(Boolean(titleMatch && titleMatch[1].trim()), 'missing or empty <title>');
  if (expectedTitle !== null && titleMatch) {
    check(
      titleMatch[1] === expectedTitle,
      `expected <title>${expectedTitle}</title>, found <title>${titleMatch[1]}</title>`,
    );
  }

  const skipIndex = html.search(/<a\b[^>]*class="[^"]*\bskip-link\b/);
  const headerIndex = html.search(/<header[ >]/);
  check(skipIndex >= 0, 'missing skip link (a.skip-link)');
  check(headerIndex >= 0, 'missing <header>');
  check(
    skipIndex >= 0 && headerIndex >= 0 && skipIndex < headerIndex,
    'skip link must appear before <header> in source order',
  );

  // M2-09: OpenGraph / Twitter / canonical head.
  const meta = (attr, key) => {
    const tag = html.match(new RegExp(`<meta[^>]*\\b${attr}="${key}"[^>]*>`, 'i'));
    if (!tag) return null;
    const content = tag[0].match(/\bcontent="([^"]*)"/i);
    return content ? content[1] : null;
  };
  const og = (key) => meta('property', key);
  const canonicalTag = html.match(/<link[^>]*\brel="canonical"[^>]*>/i);
  const canonical = canonicalTag ? (canonicalTag[0].match(/\bhref="([^"]*)"/i)?.[1] ?? null) : null;

  // Served path from the generated file path: everything between "/public" and the
  // trailing "index.html" (root => "/"). Robust to the CI "apps/portfolio/" prefix.
  const servedPath = file.match(/\/public(\/.*)?index\.html$/)?.[1] || '/';
  const expectedUrl = `${SITE_ORIGIN}${servedPath}`;

  check(Boolean(og('og:title')?.trim()), 'missing or empty og:title');
  if (expectedTitle !== null) {
    check(
      og('og:title') === expectedTitle,
      `og:title must mirror <title> "${expectedTitle}", found "${og('og:title')}"`,
    );
  }
  check(Boolean(og('og:description')?.trim()), 'missing or empty og:description');
  check(og('og:type') === 'website', `expected og:type "website", found "${og('og:type')}"`);
  check(
    og('og:site_name') === 'CareerForge',
    `expected og:site_name "CareerForge", found "${og('og:site_name')}"`,
  );
  check(og('og:url') === expectedUrl, `expected og:url "${expectedUrl}", found "${og('og:url')}"`);
  check(
    meta('name', 'twitter:card') === 'summary',
    `expected twitter:card "summary", found "${meta('name', 'twitter:card')}"`,
  );
  check(canonical === expectedUrl, `expected canonical "${expectedUrl}", found "${canonical}"`);
}

if (failures.length > 0) {
  console.error(`assert-prerender: ${failures.length} failure(s):`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`assert-prerender: OK — ${specs.length} page(s) checked`);
