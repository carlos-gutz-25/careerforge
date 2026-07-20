<script setup lang="ts">
// Renders the scaffold content doc (content/index.md). ContentRenderer walks
// the parsed AST into vnodes — no v-html, so the repo-wide escape law holds.
const { data: page } = await useAsyncData('home', () => queryCollection('pages').path('/').first());
</script>

<template>
  <main>
    <h1>CareerForge</h1>
    <ContentRenderer v-if="page" :value="page" />
  </main>
</template>
