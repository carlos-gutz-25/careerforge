// AppPanel primitive (M8-07): a tokenized surface container. `tone` selects the
// surface treatment and `scroll` caps the height; the default slot is the body.
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import AppPanel from '../app/components/AppPanel.vue';

describe('AppPanel (M8-07)', () => {
  it('renders slot content in a surface panel by default', async () => {
    const wrapper = await mountSuspended(AppPanel, {
      slots: { default: 'panel body' },
    });
    const panel = wrapper.get('.app-panel');
    expect(panel.classes()).toContain('app-panel--surface');
    expect(panel.classes()).not.toContain('app-panel--scroll');
    expect(panel.text()).toContain('panel body');
  });

  it('applies the quote tone and the scroll modifier', async () => {
    const wrapper = await mountSuspended(AppPanel, {
      props: { tone: 'quote', scroll: true },
    });
    const panel = wrapper.get('.app-panel');
    expect(panel.classes()).toContain('app-panel--quote');
    expect(panel.classes()).toContain('app-panel--scroll');
  });
});
