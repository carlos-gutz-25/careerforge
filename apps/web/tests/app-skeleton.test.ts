// AppSkeleton primitive (M8-07): shimmer bars for the 10-20s LLM waits. It is
// decorative (aria-hidden) and renders `lines` bars (default 3).
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import AppSkeleton from '../app/components/AppSkeleton.vue';

describe('AppSkeleton (M8-07)', () => {
  it('renders three bars by default and hides from assistive tech', async () => {
    const wrapper = await mountSuspended(AppSkeleton);
    const root = wrapper.get('.app-skeleton');
    expect(root.attributes('aria-hidden')).toBe('true');
    expect(wrapper.findAll('.app-skeleton-bar')).toHaveLength(3);
  });

  it('renders the requested number of bars', async () => {
    const wrapper = await mountSuspended(AppSkeleton, { props: { lines: 5 } });
    expect(wrapper.findAll('.app-skeleton-bar')).toHaveLength(5);
  });
});
