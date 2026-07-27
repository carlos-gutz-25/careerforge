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
});
