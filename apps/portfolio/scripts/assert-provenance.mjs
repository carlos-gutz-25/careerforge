// Asserts every PRERENDERED case-study page (real `nuxt generate` output) carries
// a valid honesty label. M2-04 requires every case study to display a provenance
// label; `app/pages/case-studies/[slug].vue` renders it as
// `<p class="provenance" data-provenance="<token>">Provenance: <label></p>`. That
// markup exists only in generate output (in unit tests `page` is null and
// ContentRenderer is off), so — like assert-prerender.mjs — this runs against the
// generated output in CI (portfolio-build, after `generate`).
//
// SEPARATE from assert-prerender.mjs on purpose: that script asserts home-page
// structure (exact `<title>CareerForge</title>`, single <main>, skip link) that
// case-study pages deliberately do NOT share. This one asserts, per case-study
// page: exactly one data-provenance attribute whose value is one of the three
// storage tokens, a visible "Provenance:" label, and exactly one <h1>. Structural
// HTML only — not an a11y auditor (axe/Lighthouse budgets are the M2-03 gates).
//
// The token set is duplicated from app/utils/provenance.ts by intent: this gate
// is dependency-free and must not import app code. R2 in validate-case-studies.mjs
// already rejects an out-of-enum provenance at the source; this is defence in
// depth on the rendered output.
//
// M2-09: also asserts the OpenGraph / canonical head per case-study page —
// og:title/og:description present, og:type EXACTLY "article" (distinct from the
// "website" landing pages), and og:url + canonical EXACTLY the page's own served
// URL `${SITE_ORIGIN}/case-studies/<slug>/`. Two planted-FAILs cover these legs:
// a wrong-origin/missing-trailing-slash og:url (correctness) and a missing
// og:type=article (presence) — a presence-only plant would leave the og:url
// correctness regex unproven.
//
// Exit 0 = all pages valid · 1 = a violation · 2 = cannot run (no case-study
// output). Exit 2 is never a pass. Run bare, never piped (pipefail law).
//
// Usage: node apps/portfolio/scripts/assert-provenance.mjs [case-studies-output-dir]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '.output/public/case-studies';
const VALID = new Set(['professional', 'personal', 'personal_ai_assisted']);

// The published apex, used to build each page's expected absolute og:url/canonical.
// BREADCRUMB: this origin is ALSO hardcoded in app/composables/useSeo.ts and
// scripts/assert-prerender.mjs. A domain change is a deliberate multi-file event
// (ADR-0008, M2-11 cutover precedent) — move all three together.
const SITE_ORIGIN = 'https://carlosgutz.com';

if (!existsSync(root)) {
  console.error(`assert-provenance: cannot run — no case-study output dir at ${root}`);
  process.exit(2);
}

const pages = [];
for (const entry of readdirSync(root)) {
  const idx = join(root, entry, 'index.html');
  if (existsSync(idx) && statSync(idx).isFile()) pages.push(idx);
}
if (pages.length === 0) {
  console.error(`assert-provenance: cannot run — no case-study pages under ${root}`);
  process.exit(2);
}

const failures = [];
for (const file of pages) {
  const html = readFileSync(file, 'utf8');

  const h1s = html.match(/<h1[ >]/g) ?? [];
  if (h1s.length !== 1) failures.push(`${file}: expected exactly one <h1>, found ${h1s.length}`);

  const provValues = [...html.matchAll(/data-provenance="([^"]*)"/g)].map((m) => m[1]);
  if (provValues.length !== 1) {
    failures.push(
      `${file}: expected exactly one data-provenance attribute, found ${provValues.length}`,
    );
  } else if (!VALID.has(provValues[0])) {
    failures.push(
      `${file}: data-provenance="${provValues[0]}" is not one of ${[...VALID].join(', ')}`,
    );
  }

  if (!/Provenance:\s*\S/.test(html)) {
    failures.push(`${file}: missing the visible "Provenance:" label`);
  }

  // M2-09: OpenGraph / canonical head. slug is the directory holding index.html.
  const meta = (attr, key) => {
    const tag = html.match(new RegExp(`<meta[^>]*\\b${attr}="${key}"[^>]*>`, 'i'));
    if (!tag) return null;
    const content = tag[0].match(/\bcontent="([^"]*)"/i);
    return content ? content[1] : null;
  };
  const og = (key) => meta('property', key);
  const canonicalTag = html.match(/<link[^>]*\brel="canonical"[^>]*>/i);
  const canonical = canonicalTag ? (canonicalTag[0].match(/\bhref="([^"]*)"/i)?.[1] ?? null) : null;
  const slug = file.split('/').at(-2);
  const expectedUrl = `${SITE_ORIGIN}/case-studies/${slug}/`;

  if (!og('og:title')?.trim()) failures.push(`${file}: missing or empty og:title`);
  if (!og('og:description')?.trim()) failures.push(`${file}: missing or empty og:description`);
  if (og('og:type') !== 'article') {
    failures.push(`${file}: expected og:type "article", found "${og('og:type')}"`);
  }
  if (og('og:url') !== expectedUrl) {
    failures.push(`${file}: expected og:url "${expectedUrl}", found "${og('og:url')}"`);
  }
  if (canonical !== expectedUrl) {
    failures.push(`${file}: expected canonical "${expectedUrl}", found "${canonical}"`);
  }
}

if (failures.length > 0) {
  console.error(`assert-provenance: ${failures.length} failure(s):`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(
  `assert-provenance: OK — ${pages.length} case-study page(s) carry a valid provenance label`,
);
