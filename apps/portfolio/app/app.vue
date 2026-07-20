<script setup lang="ts">
// A function titleTemplate must live here (app.vue via useHead), not in
// nuxt.config's app.head — that is serialized and cannot carry a function. The
// home page sets no per-page title, so its <title> is exactly "CareerForge";
// inner pages (M2-05+) set a title and get "Title · CareerForge". (F5)
useHead({
  titleTemplate: (title) => (title ? `${title} · CareerForge` : 'CareerForge'),
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
