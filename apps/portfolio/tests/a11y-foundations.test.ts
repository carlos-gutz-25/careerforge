import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';

import App from '../app/app.vue';

// Full render chain App -> default layout -> index page (the vitest `nuxt`
// environment builds the real app). Deliberately NOT the node docblock used by
// the CSS-text gate — this suite needs the DOM. In unit tests `page` is null
// (Content's client query 404s in the mock), so ContentRenderer is off and the
// only h1 is the template's; the prerender-only duplicate-h1 is covered by
// scripts/assert-prerender.mjs in CI.
describe('apps/portfolio a11y foundations (App -> layout -> page)', () => {
  it('renders exactly one h1 and one main, each landmark once, no positive tabindex', async () => {
    const wrapper = await mountSuspended(App, { route: '/' });

    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.findAll('main')).toHaveLength(1);
    expect(wrapper.findAll('header')).toHaveLength(1);
    expect(wrapper.findAll('nav')).toHaveLength(1);
    expect(wrapper.findAll('footer')).toHaveLength(1);

    expect(wrapper.find('main').attributes('id')).toBe('main');

    const positive = wrapper
      .findAll('[tabindex]')
      .filter((el) => Number(el.attributes('tabindex')) > 0);
    expect(positive).toHaveLength(0);
  });

  it('the skip link is the first focusable element and targets the main id', async () => {
    const wrapper = await mountSuspended(App, { route: '/' });

    // DOM-order proxy for tab order (happy-dom has no sequential focus nav).
    const focusable = wrapper.findAll('a[href], button, [tabindex]:not([tabindex="-1"])');
    expect(focusable.length).toBeGreaterThan(0);

    const first = focusable[0];
    const mainId = wrapper.find('main').attributes('id');
    expect(first.attributes('href')).toBe(`#${mainId}`);
  });

  it('sets the exact document title', async () => {
    await mountSuspended(App, { route: '/' });

    // Title comes from app.vue's useHead titleTemplate and IS applied in this
    // env (probed: "CareerForge"). Home sets no page title, so the falsy branch
    // yields exactly "CareerForge" (F5).
    await vi.waitFor(() => {
      expect(document.title).toBe('CareerForge');
    });

    // NOTE (G5 applied to lang): `document.documentElement.lang` is empty in
    // this mount env because htmlAttrs.lang lives in nuxt.config's app.head,
    // which mountSuspended does not apply. Rather than weaken to a presence
    // check, lang is verified against REAL generate output by
    // scripts/assert-prerender.mjs (CI portfolio-build). The exact title is
    // checked in BOTH places.
  });
});
