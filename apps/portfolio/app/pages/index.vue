<script setup lang="ts">
// Renders the scaffold content doc (content/index.md). ContentRenderer is NOT
// escape-equivalent — Nuxt Content's markdown pipeline can emit raw HTML from a
// source document. That is safe HERE only because portfolio content is
// repo-authored and trusted. CLAUDE.md's escape law binds UNTRUSTED posting
// text, which cannot reach this app (zero platform imports, no DB/API access).
// If posting-derived text ever feeds portfolio content (M4-01's exercise →
// case-study path), it must be sanitized at that boundary — see M2-04.
const { data: page } = await useAsyncData('home', () => queryCollection('pages').path('/').first());
</script>

<template>
  <main>
    <h1>CareerForge</h1>
    <ContentRenderer v-if="page" :value="page" />
  </main>
</template>
