<script setup lang="ts">
// About page (M2-08). Renders content/about.md from the `pages` collection.
// Mirrors index.vue: the layout owns <main>; this template owns the single <h1>
// (D1); ContentRenderer emits the body starting at <h2>. Content is
// repo-authored and trusted — the ContentRenderer note in index.vue applies;
// this is a REVIEWED-for-public subset of docs/profile/, never the raw profile.
const { data: page } = await useAsyncData('about', () =>
  queryCollection('pages').path('/about').first(),
);

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true });
}

// title "About" → app.vue's titleTemplate makes "About · CareerForge"; useSeo
// emits the matching OG / Twitter / canonical head (M2-09).
useSeo({
  title: page.value?.title,
  description: page.value?.description ?? '',
  ogType: 'website',
});
</script>

<template>
  <h1>{{ page?.title }}</h1>
  <ContentRenderer v-if="page" :value="page" />
</template>
