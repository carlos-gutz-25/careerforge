<script setup lang="ts">
// Resume page (M2-08). Renders content/resume.md from the `pages` collection.
// Mirrors index.vue/about.vue: the layout owns <main>; this template owns the
// single <h1> (D1); the body starts at <h2>. This is the REVIEWED-for-public
// resume subset (no phone, no home address; contact via email/LinkedIn) — never
// the raw docs/profile/ resume.
const { data: page } = await useAsyncData('resume', () =>
  queryCollection('pages').path('/resume').first(),
);

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true });
}

// app.vue's titleTemplate appends " · CareerForge".
useHead({ title: () => page.value?.title });
useSeoMeta({ description: () => page.value?.description ?? '' });
</script>

<template>
  <h1>{{ page?.title }}</h1>
  <ContentRenderer v-if="page" :value="page" />
</template>
