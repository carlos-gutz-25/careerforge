// AppStateChip primitive (M8-07): an inline status pill. `variant` maps to a
// gate-verified semantic color pair; the label is the default slot.
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import AppStateChip from '../app/components/AppStateChip.vue';

const SEMANTIC = ['draft', 'reviewed', 'danger', 'info'] as const;

describe('AppStateChip (M8-07)', () => {
  it('renders the label with the neutral variant by default', async () => {
    const wrapper = await mountSuspended(AppStateChip, {
      slots: { default: 'unclassified' },
    });
    const chip = wrapper.get('.app-chip');
    expect(chip.classes()).toContain('app-chip--neutral');
    expect(chip.text()).toBe('unclassified');
  });

  it.each(SEMANTIC)('maps the %s variant to its modifier class', async (variant) => {
    const wrapper = await mountSuspended(AppStateChip, {
      props: { variant },
      slots: { default: variant },
    });
    expect(wrapper.get('.app-chip').classes()).toContain(`app-chip--${variant}`);
  });

  // M8-24: `variant` is the COLOR channel and carries no structure, so a chip
  // that is merely green (an accepted offer, an active upgrade) must NOT pick up
  // the draft-until-reviewed signature. This is the assertion that keeps the two
  // channels apart at the component boundary rather than only in the stylesheet.
  it.each(SEMANTIC)('does not claim review-state from the %s variant alone', async (variant) => {
    const wrapper = await mountSuspended(AppStateChip, {
      props: { variant },
      slots: { default: variant },
    });
    const classes = wrapper.get('.app-chip').classes();
    expect(classes.some((c) => c.startsWith('app-chip--state-'))).toBe(false);
  });

  it.each(['draft', 'reviewed'] as const)(
    'applies the %s review-state signature and its matching color',
    async (reviewState) => {
      const wrapper = await mountSuspended(AppStateChip, {
        props: { reviewState },
        slots: { default: reviewState },
      });
      const classes = wrapper.get('.app-chip').classes();
      // Drives the structure...
      expect(classes).toContain(`app-chip--state-${reviewState}`);
      // ...and the color too, so a law-bearing chip cannot drift out of sync
      // with its own color by passing one prop and forgetting the other.
      expect(classes).toContain(`app-chip--${reviewState}`);
    },
  );
});
