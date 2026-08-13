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
/* M8-24 - draft vs reviewed is the console's signature, and it must survive the
 * loss of color. Everything below the color lines is what carries it: a DASHED
 * edge and the lighter weight say "provisional"; a SOLID edge and the heavier
 * weight say "a human settled this". Both signals are visible in greyscale, to
 * a monochrome display, and to anyone who cannot separate amber from green -
 * which is the point, since color alone would fail exactly those readers.
 * No token is added or changed here; the palette is untouched (D1(3)). */
.app-chip--draft {
  color: var(--color-accent);
  background: var(--color-draft-bg);
  border-color: var(--color-accent);
  border-style: dashed;
  font-weight: 400;
}
.app-chip--reviewed {
  color: var(--color-reviewed);
  background: var(--color-reviewed-bg);
  border-color: var(--color-reviewed);
  border-style: solid;
  font-weight: 600;
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
