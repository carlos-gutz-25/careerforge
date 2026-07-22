<script setup lang="ts">
// Case-study detail page. Renders one honesty-labeled study from the caseStudies
// collection (content/case-studies/<slug>.md). The provenance label is displayed
// directly under the <h1>, satisfying M2-04's "every case study displays a
// provenance label". Content is repo-authored and trusted — the ContentRenderer
// note in app/pages/index.vue applies: nothing from docs/profile/ enters this app.
//
// M2-04 ships ZERO case-study content, so this route prerenders nothing today
// (Nitro crawls from `/`, no nav link points here). M2-05 adds the content +
// index/nav links + a data-provenance prerender assertion (BACKLOG close notes).
const route = useRoute();
// Canonical case-study URLs carry a trailing slash (index.vue), but the content
// item's path has none. Strip it so the query matches whether the page is
// reached at /case-studies/<slug> or /case-studies/<slug>/ (prerender + client).
const contentPath = route.path.replace(/\/$/, '') || '/';
const { data: page } = await useAsyncData(`case-study:${contentPath}`, () =>
  queryCollection('caseStudies').path(contentPath).first(),
);

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Case study not found', fatal: true });
}

// Function form so page.value is read reactively (no ref-narrowing across the
// 404 guard). app.vue's titleTemplate appends " · CareerForge".
useHead({ title: () => page.value?.title });
useSeoMeta({ description: () => page.value?.description ?? '' });
</script>

<template>
  <article>
    <h1>{{ page?.title }}</h1>
    <!-- data-provenance is the stable hook for M2-05's prerender assertions. -->
    <p class="provenance" :data-provenance="page?.provenance">
      Provenance: {{ provenanceLabel(page?.provenance) }}
    </p>
    <ContentRenderer v-if="page" :value="page" />
  </article>
</template>
