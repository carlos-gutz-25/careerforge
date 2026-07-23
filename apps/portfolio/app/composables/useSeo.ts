// Centralizes the portfolio's SEO / OpenGraph head so every page emits one
// consistent, correct set of tags (M2-09). Reactive (functions/refs), so it MUST
// run inside a component setup — never in nuxt.config's serialized app.head.
//
// og:title / twitter:title mirror the FINAL rendered <title>: inner pages get the
// app.vue titleTemplate suffix " · CareerForge"; the home page passes `fullTitle`
// to BYPASS that suffix (its <title> is a standalone string, decoupled from its
// <h1>). og:url and the canonical <link> are absolute and trailing-slash
// normalized so they match the URL GitHub Pages actually serves
// (<path>/index.html) — a mismatch makes a page declare a canonical different
// from its own address.
//
// og:image is deliberately omitted this milestone (twitter:card=summary, no
// large-image card); it needs a designed 1200x630 raster PNG — parked (M2-09).

// The published apex. BREADCRUMB: this origin is ALSO hardcoded in
// scripts/assert-prerender.mjs and scripts/assert-provenance.mjs. A domain change
// is a deliberate multi-file event (ADR-0008, M2-11 cutover precedent) — move all
// three together.
const SITE_ORIGIN = 'https://carlosgutz.com';
const SITE_NAME = 'CareerForge';

interface UseSeoOptions {
  /** Page title WITHOUT the " · CareerForge" suffix; app.vue's titleTemplate adds it. */
  title?: string;
  /** Full document title that BYPASSES the titleTemplate suffix (home page only). */
  fullTitle?: string;
  description?: string;
  ogType?: 'website' | 'article';
}

export function useSeo(options: UseSeoOptions) {
  const route = useRoute();

  // Trailing-slash normalized absolute URL: root stays "/", every other path gets
  // exactly one trailing slash — matching <path>/index.html on the static host.
  const url = computed(() => {
    const path = route.path;
    const normalized = path === '/' ? '/' : `${path.replace(/\/$/, '')}/`;
    return `${SITE_ORIGIN}${normalized}`;
  });

  // The FINAL rendered <title>, mirrored into og:title / twitter:title.
  const renderedTitle =
    options.fullTitle ?? (options.title ? `${options.title} · ${SITE_NAME}` : SITE_NAME);

  const description = options.description ?? '';

  useHead({
    // fullTitle bypasses app.vue's suffix; otherwise inherit it (undefined = no override).
    ...(options.fullTitle ? { titleTemplate: null } : {}),
    title: options.fullTitle ?? options.title,
    link: [{ rel: 'canonical', href: url }],
  });

  useSeoMeta({
    description: () => description,
    ogTitle: () => renderedTitle,
    ogDescription: () => description,
    ogType: () => options.ogType ?? 'website',
    ogUrl: () => url.value,
    ogSiteName: () => SITE_NAME,
    twitterCard: 'summary',
    twitterTitle: () => renderedTitle,
    twitterDescription: () => description,
  });
}
