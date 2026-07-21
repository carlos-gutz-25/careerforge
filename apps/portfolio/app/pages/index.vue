<script setup lang="ts">
// Renders the scaffold content doc (content/index.md). ContentRenderer is NOT
// escape-equivalent — Nuxt Content's markdown pipeline can emit raw HTML from a
// source document. That is safe HERE only because portfolio content is
// repo-authored and trusted. CLAUDE.md's escape law binds UNTRUSTED posting
// text, which cannot reach this app (zero platform imports, no DB/API access).
// If posting-derived text ever feeds portfolio content (M4-01's exercise →
// case-study path), it must be sanitized at that boundary — see M2-04.
const { data: page } = await useAsyncData('home', () => queryCollection('pages').path('/').first());

// Description only — NOT title. The home page sets no page title, so its
// <title> is exactly "CareerForge" via the app.vue titleTemplate (F5). The
// layout owns <main>; the template owns the single <h1> (D1).
useSeoMeta({
  description: () => page.value?.description ?? '',
});
</script>

<template>
  <h1>{{ page?.title ?? 'CareerForge' }}</h1>
  <div style="overflow: scroll; height: 30px; width: 140px">
    <p>a</p>
    <p>b</p>
    <p>c</p>
    <p>d</p>
    <p>e</p>
    <p>f</p>
    <p>g</p>
    <p>h</p>
  </div>
  <ContentRenderer v-if="page" :value="page" />
</template>
