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
//                    (home pins "CareerForge"; about/resume pin their own
//                    "<Page> · CareerForge"). When absent, <title> need only be
//                    non-empty. This is the ONLY gate that guarantees a single
//                    <h1> on the pages collection (about/resume have no R4-style
//                    body-h1 check), so a stray `#` in the markdown body is
//                    caught here — demonstrated by planting a second <h1> on
//                    /about/ and running the exact CI command below.
//
// Usage:
//   node apps/portfolio/scripts/assert-prerender.mjs \
//     .output/public/index.html::CareerForge \
//     .output/public/about/index.html::'About · CareerForge' \
//     .output/public/resume/index.html::'Resume · CareerForge'
import { readFileSync } from 'node:fs';

// Default to the home page (backward compatible) when no args are given.
const args = process.argv.slice(2);
const specs = args.length > 0 ? args : ['.output/public/index.html::CareerForge'];

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
}

if (failures.length > 0) {
  console.error(`assert-prerender: ${failures.length} failure(s):`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`assert-prerender: OK — ${specs.length} page(s) checked`);
