<script setup lang="ts">
// Dusk Console full-width notice primitive (M10-04). A page-spanning banner
// for a persistent instance-level notice (the public demo banner is the first
// consumer). role="note" so assistive tech announces it as an aside, not an
// interruptive alert. `tone` maps to a gate-verified semantic color pair
// (strong color on its subtle -bg tint, AA 4.5:1 in light and dark - the same
// PAIRS tokens-contrast.test.ts asserts). Static by construction (no
// animation), so it is reduced-motion-safe with nothing to disable. Content is
// the default slot. Consumes --color-* only - no raw hex.
withDefaults(defineProps<{ tone?: 'info' | 'danger' }>(), { tone: 'info' });
</script>

<template>
  <div class="app-banner" :class="`app-banner--${tone}`" role="note">
    <slot />
  </div>
</template>

<style scoped>
.app-banner {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-sm);
  text-align: center;
  border-bottom: 1px solid transparent;
}
.app-banner--info {
  color: var(--color-info);
  background: var(--color-info-bg);
  border-color: var(--color-info);
}
.app-banner--danger {
  color: var(--color-danger);
  background: var(--color-danger-bg);
  border-color: var(--color-danger);
}
</style>
