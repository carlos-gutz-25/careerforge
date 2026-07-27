<script setup lang="ts">
// Dusk Console status pill (M8-07). One inline chip; `variant` maps to a
// gate-verified semantic pair (strong color on its subtle -bg tint), AA 4.5:1
// in both light and dark - the exact PAIRS asserted by tokens-contrast.test.ts.
// Label comes from the default slot. Consumes --color-* only - no raw hex.
withDefaults(
  defineProps<{
    variant?: 'neutral' | 'draft' | 'reviewed' | 'danger' | 'info';
  }>(),
  { variant: 'neutral' },
);
</script>

<template>
  <span class="app-chip" :class="`app-chip--${variant}`">
    <slot />
  </span>
</template>

<style scoped>
.app-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-sm);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}
.app-chip--neutral {
  color: var(--color-text);
  background: var(--color-bg);
  border-color: var(--color-border);
}
.app-chip--draft {
  color: var(--color-accent);
  background: var(--color-draft-bg);
  border-color: var(--color-accent);
}
.app-chip--reviewed {
  color: var(--color-reviewed);
  background: var(--color-reviewed-bg);
  border-color: var(--color-reviewed);
}
.app-chip--danger {
  color: var(--color-danger);
  background: var(--color-danger-bg);
  border-color: var(--color-danger);
}
.app-chip--info {
  color: var(--color-info);
  background: var(--color-info-bg);
  border-color: var(--color-info);
}
</style>
