<script setup lang="ts">
// Dusk Console surface primitive (M8-07). A tokenized container for grouped
// content: `tone` picks the surface treatment ("surface" = bordered card,
// "quote" = left-ruled evidence panel), `scroll` caps the height for long
// evidence/preview bodies. Consumes --color-* only - no raw hex.
withDefaults(defineProps<{ tone?: 'surface' | 'quote'; scroll?: boolean }>(), {
  tone: 'surface',
  scroll: false,
});
</script>

<template>
  <div class="app-panel" :class="[`app-panel--${tone}`, { 'app-panel--scroll': scroll }]">
    <slot />
  </div>
</template>

<style scoped>
.app-panel {
  padding: var(--space-4);
  border-radius: var(--radius-md);
}
.app-panel--surface {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
}
.app-panel--quote {
  background: var(--color-panel);
  border-left: 3px solid var(--color-border);
  border-radius: 0;
}
.app-panel--scroll {
  max-height: 24rem;
  overflow: auto;
}
</style>
