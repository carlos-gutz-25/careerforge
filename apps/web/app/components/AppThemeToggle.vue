<script setup lang="ts">
// Dusk Console three-state theme toggle (M8-06). Single instance lives in the
// shell header; it owns the one-time client hydration of the persisted choice.
const { label, cycle, initTheme } = useTheme();

onMounted(initTheme);
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    data-testid="theme-toggle"
    :aria-label="`Theme: ${label}. Activate to change.`"
    @click="cycle"
  >
    <span aria-hidden="true">◐</span>
    <span class="theme-toggle-label">{{ label }}</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  font: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.theme-toggle:hover {
  border-color: var(--color-link);
}
</style>
