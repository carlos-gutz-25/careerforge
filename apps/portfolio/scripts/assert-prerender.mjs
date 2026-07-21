// Asserts the PRERENDERED home page (real `nuxt generate` output) carries the
// accessible-foundation structure. The duplicate-h1 defect and the lang/title
// head exist ONLY in generate output (in unit tests `page` is null and
// ContentRenderer is off), so this gate runs against that output in CI
// (portfolio-build, after `generate`). Structural HTML only — this is NOT an
// a11y auditor; axe/Lighthouse budgets are M2-03.
//
// Usage: node apps/portfolio/scripts/assert-prerender.mjs [path-to-index.html]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? '.output/public/index.html';
const html = readFileSync(file, 'utf8');

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const h1s = html.match(/<h1[ >]/g) ?? [];
check(h1s.length === 1, `expected exactly one <h1>, found ${h1s.length}`);

const mains = html.match(/<main[ >]/g) ?? [];
check(mains.length === 1, `expected exactly one <main>, found ${mains.length}`);
check(/<main[^>]*\bid="main"/.test(html), 'missing <main id="main">');

check(/<html[^>]*\blang="en"/.test(html), 'missing <html lang="en">');
check(/<title>CareerForge<\/title>/.test(html), 'missing exact <title>CareerForge</title>');

const skipIndex = html.search(/<a\b[^>]*class="[^"]*\bskip-link\b/);
const headerIndex = html.search(/<header[ >]/);
check(skipIndex >= 0, 'missing skip link (a.skip-link)');
check(headerIndex >= 0, 'missing <header>');
check(
  skipIndex >= 0 && headerIndex >= 0 && skipIndex < headerIndex,
  'skip link must appear before <header> in source order',
);

if (failures.length > 0) {
  console.error(`assert-prerender: ${failures.length} failure(s) in ${file}:`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`assert-prerender: OK — ${file}`);
