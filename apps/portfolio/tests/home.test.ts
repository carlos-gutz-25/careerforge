import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import index from '../app/pages/index.vue';

// Page-component-in-isolation check (no layout): the index page owns the single
// <h1> and, with `page` null in unit tests, renders the D1 hardcoded fallback
// "Carlos Gutierrez" (fallback == frontmatter value - F6: this exercises the fallback
// constant, not the frontmatter path). Full App -> layout -> page structure
// (single main, landmarks, skip link, tabindex, exact title) lives in
// a11y-foundations.test.ts — kept separate to avoid duplication.
describe('apps/portfolio home page', () => {
  it('renders the template-owned h1 fallback', async () => {
    const wrapper = await mountSuspended(index);
    expect(wrapper.find('h1').text()).toBe('Carlos Gutierrez');
  });

  // M8-20 signature hero: the name carries the display-scale class and a
  // non-interactive provenance stamp sits beneath it. The stamp MUST stay a
  // plain <p> (never a link) so the skip link remains the first focusable
  // element (the a11y-foundations landmark/tab-order gate).
  it('renders the hero name with the display class', async () => {
    const wrapper = await mountSuspended(index);
    expect(wrapper.find('h1').classes()).toContain('hero-name');
  });

  it('renders a non-interactive hero provenance stamp beneath the name', async () => {
    const wrapper = await mountSuspended(index);
    const stamp = wrapper.find('.hero-stamp');
    expect(stamp.exists()).toBe(true);
    expect(stamp.element.tagName).toBe('P');
    expect(stamp.find('a').exists()).toBe(false);
    expect(stamp.text()).toContain('Provenance Ledger');
  });
});
