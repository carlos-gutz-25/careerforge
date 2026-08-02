// Default layout demo banner (M10-04, D2 - the FIRST of the banner's two
// mount points; the login page carries the second because it opts out of this
// layout). Rendered iff useDemoMode() is true. useState drives the flag
// directly - no network.
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';

import DefaultLayout from '../app/layouts/default.vue';
import { useDemoState } from '../app/composables/use-demo-mode.ts';
import { useSessionUser } from '../app/composables/use-auth.ts';

describe('default layout demo banner (M10-04)', () => {
  beforeEach(() => {
    useDemoState().value = undefined;
    // Unauthenticated: the topbar branch renders (no NuxtLink nav to stub); the
    // banner mount is independent of the auth branch.
    useSessionUser().value = null;
  });

  it('renders the demo banner when the instance is in demo mode', async () => {
    useDemoState().value = true;
    const wrapper = await mountSuspended(DefaultLayout, { slots: { default: () => 'content' } });
    expect(wrapper.find('.app-banner').exists()).toBe(true);
    expect(wrapper.get('.app-banner').text()).toContain('Public demo');
  });

  it('omits the banner on a real instance', async () => {
    useDemoState().value = false;
    const wrapper = await mountSuspended(DefaultLayout, { slots: { default: () => 'content' } });
    expect(wrapper.find('.app-banner').exists()).toBe(false);
  });
});
