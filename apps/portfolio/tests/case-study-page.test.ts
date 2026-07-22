// nuxt env (project default). Renders app/pages/case-studies/[slug].vue in
// isolation with queryCollection mocked, proving the provenance label is DISPLAYED
// in the DOM (exact text per token, precedes the body content). The token→label
// MAPPING is unit-tested separately in provenance.test.ts (node env).
//
// COVERAGE LEG (mockNuxtImport risk resolved empirically this slice): this file
// carries the rendered-label proof via mockNuxtImport('queryCollection') +
// mountSuspended — CONFIRMED working (see the PR body's slice-B note). If it had
// not worked, the fallback recorded in the plan was to mock useAsyncData, then to
// fall back to provenance.test.ts as the sole carrier with the render proof
// deferred to M2-05's prerender assertions. It worked, so this file carries it.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CaseStudyPage from '../app/pages/case-studies/[slug].vue';

const { queryMock, routeMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  // Mutable route so each test can use a DISTINCT path: the page keys
  // useAsyncData on route.path, and a shared key would return the first test's
  // cached payload to every later test (the mockNuxtImport risk's real teeth —
  // the query mock itself works; the payload cache is what bites).
  routeMock: { path: '/case-studies/fixture' },
}));

// queryCollection('caseStudies').path(route.path).first() → the fixture.
mockNuxtImport('queryCollection', () => queryMock);
mockNuxtImport('useRoute', () => () => routeMock);

function setPage(fixture: unknown) {
  queryMock.mockReturnValue({ path: () => ({ first: async () => fixture }) });
}

const base = {
  title: 'Fictional Widget Pipeline',
  description: 'A fictional case-study fixture — no real project.',
  path: '/case-studies/fictional-widget',
  // Minimal @nuxt/content body so ContentRenderer (stubbed) has a value.
  body: { type: 'minimal', value: [] },
};

const tokens = [
  ['professional', 'Professional'],
  ['personal', 'Personal'],
  ['personal_ai_assisted', 'Personal, AI-assisted'],
] as const;

describe('case-study [slug] page — provenance label is displayed', () => {
  afterEach(() => queryMock.mockReset());

  for (const [token, label] of tokens) {
    it(`renders "${label}" for provenance=${token}`, async () => {
      routeMock.path = `/case-studies/${token}`; // distinct useAsyncData key per test
      setPage({ ...base, provenance: token });
      const wrapper = await mountSuspended(CaseStudyPage, {
        global: { stubs: { ContentRenderer: true } },
      });

      const prov = wrapper.find('.provenance');
      expect(prov.exists()).toBe(true);
      expect(prov.text()).toBe(`Provenance: ${label}`);
      expect(prov.attributes('data-provenance')).toBe(token);

      // h1 shows the title; the label precedes the body content in DOM order.
      expect(wrapper.find('h1').text()).toBe(base.title);
      const html = wrapper.html();
      expect(html.indexOf('class="provenance"')).toBeLessThan(html.indexOf('content-renderer'));
    });
  }
});
