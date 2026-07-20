import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import index from '../app/pages/index.vue';

describe('apps/portfolio home page', () => {
  it('renders the site heading', async () => {
    const wrapper = await mountSuspended(index);
    expect(wrapper.find('h1').text()).toBe('CareerForge');
  });
});
