// Default layout demo banner (M10-04, D2 - the FIRST of the banner's two
// mount points; the login page carries the second because it opts out of this
// layout). Rendered iff useDemoMode() is true. useState drives the flag
// directly - no network.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DefaultLayout from '../app/layouts/default.vue';
import { useSessionUser } from '../app/composables/use-auth.ts';

// Mock useDemoMode file-locally (a fake ref Vue unwraps in the template) rather
// than mutating the shared useState: mountSuspended runs the app's demo resolve
// during mount, which would race/overwrite a pre-set shared flag under the
// nuxt-env's cross-file app sharing (M10-04 test-isolation finding).
const { demoFlag } = vi.hoisted(() => ({
  demoFlag: { __v_isRef: true, value: false as boolean },
}));
mockNuxtImport('useDemoMode', () => () => ({
  demo: demoFlag,
  resolve: () => Promise.resolve(),
}));

describe('default layout demo banner (M10-04)', () => {
  beforeEach(() => {
    demoFlag.value = false;
    // Unauthenticated: the topbar branch renders (no NuxtLink nav to stub); the
    // banner mount is independent of the auth branch.
    useSessionUser().value = null;
  });

  it('renders the demo banner when the instance is in demo mode', async () => {
    demoFlag.value = true;
    const wrapper = await mountSuspended(DefaultLayout, { slots: { default: () => 'content' } });
    expect(wrapper.find('.app-banner').exists()).toBe(true);
    expect(wrapper.get('.app-banner').text()).toContain('Public demo');
  });

  it('omits the banner on a real instance', async () => {
    demoFlag.value = false;
    const wrapper = await mountSuspended(DefaultLayout, { slots: { default: () => 'content' } });
    expect(wrapper.find('.app-banner').exists()).toBe(false);
  });
});
