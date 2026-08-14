<script setup lang="ts">
// Dusk Console status pill (M8-07). One inline chip; `variant` maps to a
// gate-verified semantic pair (strong color on its subtle -bg tint), AA 4.5:1
// in both light and dark - the exact PAIRS asserted by tokens-contrast.test.ts.
// Label comes from the default slot. Consumes --color-* only - no raw hex.
//
// M8-24 - TWO INDEPENDENT CHANNELS, because they answer different questions
// (Carlos's ruling, 2026-08-13, which lifts the Story B plan's D4 "no component
// API change" for this story; the deviation is disclosed in the PR body):
//
//   `variant`     = COLOR = "how good is this?"        - used everywhere
//   `reviewState` = STRUCTURE = "has a human signed off?" - law-bearing only
//
// The distinction exists because the two were conflated: `reviewed` was doing
// duty both for genuine review-state AND for unrelated good news (an accepted
// offer, an active upgrade, a passing integrity check). Once the draft/reviewed
// STRUCTURE became the console's signature for the draft-until-reviewed law,
// that conflation would have made those surfaces silently assert the law about
// things it does not govern.
//
// So `reviewState` is the ONLY channel that claims the law. Pass it exactly
// where a human's review is genuinely the question; it drives the color too, so
// a law-bearing chip cannot drift out of sync with its own color. Everything
// else keeps `variant` and stays color-only - and therefore keeps the neutral
// structure of an ordinary chip.
withDefaults(
  defineProps<{
    variant?: 'neutral' | 'draft' | 'reviewed' | 'danger' | 'info';
    reviewState?: 'draft' | 'reviewed';
  }>(),
  { variant: 'neutral', reviewState: undefined },
);
</script>

<template>
  <span
    class="app-chip"
    :class="[
      `app-chip--${reviewState ?? variant}`,
      reviewState ? `app-chip--state-${reviewState}` : '',
    ]"
  >
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
/* The COLOR channel. These rules are color-only on purpose - they carry no
 * structure, so an accepted offer or an active upgrade can be green without
 * claiming a human reviewed it. The state-signature gate asserts this emptiness
 * directly: adding a border-style or font-weight here would re-merge the two
 * channels M8-24 exists to separate. */
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

/* The STRUCTURE channel - the console's draft-until-reviewed signature, and the
 * half that must survive the loss of color. A DASHED edge and the lighter weight
 * say "provisional"; a SOLID edge and the heavier weight say "a human settled
 * this". Both read in greyscale, on a monochrome display, and to anyone who
 * cannot separate amber from green - which is the whole point, since color alone
 * would fail exactly those readers. No token is added or changed: the palette is
 * untouched (Story B plan, D1(3)). */
.app-chip--state-draft {
  border-style: dashed;
  font-weight: 400;
}
.app-chip--state-reviewed {
  border-style: solid;
  font-weight: 600;
}
</style>
