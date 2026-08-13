<script setup lang="ts">
// Renders the scaffold content doc (content/index.md). ContentRenderer is NOT
// escape-equivalent — Nuxt Content's markdown pipeline can emit raw HTML from a
// source document. That is safe HERE only because portfolio content is
// repo-authored and trusted. CLAUDE.md's escape law binds UNTRUSTED posting
// text, which cannot reach this app (zero platform imports, no DB/API access).
// If posting-derived text ever feeds portfolio content (M4-01's exercise →
// case-study path), it must be sanitized at that boundary — see M2-04.
const { data: page } = await useAsyncData('home', () => queryCollection('pages').path('/').first());

// Case-study index (M2-05). The NuxtLinks below are load-bearing: Nitro
// prerenders the case-study routes by crawling links from `/`, and link-check
// recurses through them. Sorted by title for a deterministic prerender + gate.
const { data: studies } = await useAsyncData('case-studies', async () =>
  (await queryCollection('caseStudies').all()).sort((a, b) => a.title.localeCompare(b.title)),
);

// Home <title> is the full string "Carlos Gutierrez · Senior Software Engineer"
// (M2-09): fullTitle bypasses app.vue's " · Carlos Gutierrez" suffix, decoupling the
// document title from the <h1> ("Carlos Gutierrez"). useSeo also emits the OG /
// Twitter / canonical head. The layout owns <main>; the template owns the single
// <h1> (D1).
useSeo({
  fullTitle: 'Carlos Gutierrez · Senior Software Engineer',
  description: page.value?.description ?? '',
  ogType: 'website',
});

// M8-21: preload the hero display cut HERE, not in nuxt.config.ts. The opsz30
// face is preloaded globally because every page's headings use it; this face is
// consumed by .hero-name, which exists on THIS page only. A global preload would
// make the other 9 gated pages fetch 17KB they never render -- the opposite of
// what the perf floor is for. crossorigin is required even same-origin, else the
// preload double-fetches (the Lighthouse "preloaded font used" correctness point).
useHead({
  link: [
    {
      rel: 'preload',
      as: 'font',
      type: 'font/woff2',
      href: '/fonts/Fraunces-latin-display.woff2',
      crossorigin: '',
    },
  ],
});
</script>

<template>
  <h1 class="hero-name">{{ page?.title ?? 'Carlos Gutierrez' }}</h1>
  <!-- Hero provenance stamp (M8-20): the recurring mono verification-green mark,
       same treatment as the case-study .provenance-tag rows below. Non-interactive
       (a <p>, never a link) so the skip link stays the first focusable element
       (a11y-foundations gate). Static template text: the &middot; keeps the source
       ASCII (source-byte law) while rendering the mid-dot separator; the h1 text
       node is untouched, so the home.test / assert-prerender h1 pins still hold. -->
  <p class="hero-stamp">Provenance Ledger &middot; Evidence before claims</p>
  <ContentRenderer v-if="page" :value="page" />

  <section aria-labelledby="case-studies-heading">
    <h2 id="case-studies-heading">Case studies</h2>
    <ul class="case-study-list">
      <li v-for="study in studies ?? []" :key="study.path">
        <!-- Trailing slash: the canonical directory URL that maps to
             <slug>/index.html on ANY static host without relying on a
             `/foo`→`/foo/` redirect (link-check serves bytes verbatim). -->
        <NuxtLink :to="`${study.path}/`">{{ study.title }}</NuxtLink>
        <!-- Honesty label mirrored from the detail page; data-provenance is the
             stable hook the prerender assertion checks on the detail pages. -->
        <span class="provenance-tag" :data-provenance="study.provenance">{{
          provenanceLabel(study.provenance)
        }}</span>
        <p>{{ study.description }}</p>
      </li>
    </ul>
  </section>
</template>
