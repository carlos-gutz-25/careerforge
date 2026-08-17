// @vitest-environment node
//
// M8-25 wiring gate -- pure text-parse (mirrors fonts.test.ts / tokens-contrast.test.ts):
// reads app.vue and nuxt.config.ts AS TEXT and pins the document-title and
// html-lang wiring the M8-22 host Lighthouse run found missing.
//
// THE DRIFT THIS EXISTS TO CATCH: titles live in ONE map in app.vue rather than in
// sixteen per-page `useHead` calls. That is the right trade for reviewability, but
// it moves the failure mode -- a NEW page silently ships with no entry and falls
// back to the bare app name. So this test derives the route names from the pages
// directory itself and fails when the map does not cover them. A map that is
// merely "long enough" would not catch it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const appVue = read('../app/app.vue');
const nuxtConfig = read('../nuxt.config.ts');

/** Strip comments before asserting on VALUES: both files discuss the framework's
 *  "Nuxt app" placeholder by name in their own reasoning, and a whole-file match
 *  would flag that prose rather than a real title. Assert on code, not commentary. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const appVueCode = code(appVue);
const nuxtConfigCode = code(nuxtConfig);
const pagesDir = fileURLToPath(new URL('../app/pages', import.meta.url));

/** Nuxt's file-based route naming, for the shapes this app actually uses. */
function routeNames(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory())
      return routeNames(full, prefix ? `${prefix}-${entry}` : entry);
    if (!entry.endsWith('.vue')) return [];
    const base = entry.slice(0, -'.vue'.length).replace(/^\[(.+)\]$/, '$1');
    if (base === 'index') return [prefix || 'index'];
    return [prefix ? `${prefix}-${base}` : base];
  });
}

/** The keys of ROUTE_TITLES, read out of the source rather than imported (app.vue
 *  is an SFC with Nuxt auto-imports; parsing the literal keeps this test env-free). */
function mappedRouteNames(): string[] {
  const block = appVue.match(/const ROUTE_TITLES: Record<string, string> = \{([\s\S]*?)\n\};/);
  const body = block?.[1];
  if (body === undefined) throw new Error('ROUTE_TITLES map not found in app.vue');
  return [...body.matchAll(/^\s*'?([a-z0-9-]+)'?:/gm)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

describe('M8-25 document title (app.vue)', () => {
  it('maps every page in the pages directory to a title', () => {
    const expected = routeNames(pagesDir).sort();
    const mapped = mappedRouteNames().sort();
    // Named explicitly so a failure says WHICH page is untitled, not just a count.
    expect(mapped).toEqual(expected);
  });

  it('falls back to the app name rather than rendering a blank or a placeholder', () => {
    expect(appVueCode).toMatch(/return screen \? `\$\{screen\} - \$\{APP_NAME\}` : APP_NAME;/);
    expect(appVueCode).not.toMatch(/Nuxt app/);
  });

  it('drives the title from the route and registers it with useHead', () => {
    expect(appVue).toMatch(/const route = useRoute\(\);/);
    expect(appVue).toMatch(/useHead\(\{ title \}\);/);
  });
});

describe('M8-25 static head wiring (nuxt.config.ts)', () => {
  it('sets the html lang attribute', () => {
    // Lighthouse `html-has-lang`: without it a screen reader announces English
    // content in the user's default voice.
    expect(nuxtConfig).toMatch(/htmlAttrs:\s*\{\s*lang:\s*'en'\s*\}/);
  });

  it('sets a fallback document title that is not a framework placeholder', () => {
    expect(nuxtConfigCode).toMatch(/title:\s*'CareerForge'/);
    expect(nuxtConfigCode).not.toMatch(/Nuxt app/);
  });

  it('sets a meta description', () => {
    expect(nuxtConfig).toMatch(/name:\s*'description'/);
  });
});
