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
// Exit 0 = all pages valid · 1 = a violation · 2 = cannot run (no case-study
// output). Exit 2 is never a pass. Run bare, never piped (pipefail law).
//
// Usage: node apps/portfolio/scripts/assert-provenance.mjs [case-studies-output-dir]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '.output/public/case-studies';
const VALID = new Set(['professional', 'personal', 'personal_ai_assisted']);

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
}

if (failures.length > 0) {
  console.error(`assert-provenance: ${failures.length} failure(s):`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(
  `assert-provenance: OK — ${pages.length} case-study page(s) carry a valid provenance label`,
);
