<script setup lang="ts">
// Dusk Console empty-state primitive (M8-07). A centered, muted placeholder for
// "nothing here yet" surfaces. Default slot = message; optional #action slot =
// a call to action. Consumes --color-* only - no raw hex.
</script>

<template>
  <div class="app-empty">
    <p class="app-empty-message"><slot /></p>
    <div v-if="$slots.action" class="app-empty-action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.app-empty {
  padding: var(--space-8) var(--space-4);
  text-align: center;
  color: var(--color-muted);
}
.app-empty-action {
  margin-top: var(--space-4);
}
</style>
