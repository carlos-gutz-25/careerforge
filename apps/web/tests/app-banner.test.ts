// AppBanner primitive (M10-04): a full-width instance-level notice. role=note
// (announced as an aside, not an alert); `tone` maps to a gate-verified
// semantic color pair; content is the default slot.
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import AppBanner from '../app/components/AppBanner.vue';

describe('AppBanner (M10-04)', () => {
  it('renders slot content in a role=note region with the default info tone', async () => {
    const wrapper = await mountSuspended(AppBanner, { slots: { default: 'Public demo.' } });
    const banner = wrapper.get('.app-banner');
    expect(banner.attributes('role')).toBe('note');
    expect(banner.classes()).toContain('app-banner--info');
    expect(banner.text()).toBe('Public demo.');
  });

  it('maps the danger tone to its modifier class', async () => {
    const wrapper = await mountSuspended(AppBanner, {
      props: { tone: 'danger' },
      slots: { default: 'stop' },
    });
    expect(wrapper.get('.app-banner').classes()).toContain('app-banner--danger');
  });
});
