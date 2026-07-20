import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import index from '../app/pages/index.vue';

// Page-component-in-isolation check (no layout): the index page owns the single
// <h1> and, with `page` null in unit tests, renders the D1 hardcoded fallback
// "CareerForge" (fallback ≡ frontmatter value — F6: this exercises the fallback
// constant, not the frontmatter path). Full App -> layout -> page structure
// (single main, landmarks, skip link, tabindex, exact title) lives in
// a11y-foundations.test.ts — kept separate to avoid duplication.
describe('apps/portfolio home page', () => {
  it('renders the template-owned h1 fallback', async () => {
    const wrapper = await mountSuspended(index);
    expect(wrapper.find('h1').text()).toBe('CareerForge');
  });
});
