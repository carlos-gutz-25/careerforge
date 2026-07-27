<script setup lang="ts">
// Dusk Console loading skeleton (M8-07). Renders `lines` shimmer bars for the
// 10-20s LLM waits. Decorative, so aria-hidden; the reduced-motion kill switch
// in base.css freezes the shimmer automatically. Consumes --color-* only.
withDefaults(defineProps<{ lines?: number }>(), { lines: 3 });
</script>

<template>
  <div class="app-skeleton" aria-hidden="true">
    <span v-for="n in lines" :key="n" class="app-skeleton-bar" />
  </div>
</template>

<style scoped>
.app-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.app-skeleton-bar {
  height: 0.9rem;
  border-radius: var(--radius-sm);
  background: linear-gradient(
    90deg,
    var(--color-panel) 25%,
    var(--color-border) 37%,
    var(--color-panel) 63%
  );
  background-size: 400% 100%;
  animation: app-skeleton-shimmer 1.4s ease infinite;
}
.app-skeleton-bar:last-child {
  width: 60%;
}
@keyframes app-skeleton-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0 0;
  }
}
</style>
