// Requirements section on the posting detail page (M1-06): flagged runs are
// VISUALLY PROMINENT, unverified quotes are marked per row, and requirement
// text/sourceQuote render under the same escaped-interpolation law as
// rawText (they are posting-derived and just as untrusted). All fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostingDetail, PostingRequirementsResponse, Requirement } from '@careerforge/core';

import PostingDetailPage from '../app/pages/postings/[id].vue';

const { getPostingMock, listApplicationsMock, getPostingRequirementsMock, routeState } = vi.hoisted(
  () => ({
    getPostingMock: vi.fn(),
    listApplicationsMock: vi.fn(),
    getPostingRequirementsMock: vi.fn(),
    routeState: {
      params: { id: 'fictional-posting-id' } as Record<string, string>,
      query: {} as Record<string, unknown>,
    },
  }),
);

mockNuxtImport('useApi', () => () => ({
  getPosting: getPostingMock,
  updatePostingStatus: vi.fn(),
  listApplications: listApplicationsMock,
  createApplication: vi.fn(),
  getPostingRequirements: getPostingRequirementsMock,
}));
mockNuxtImport('navigateTo', () => vi.fn());
mockNuxtImport('useRoute', () => () => ({
  path: '/postings/fictional-posting-id',
  fullPath: '/postings/fictional-posting-id',
  params: routeState.params,
  query: routeState.query,
}));

function detailFixture(): PostingDetail {
  return {
    id: 'fictional-posting-id',
    company: 'Fictional Widgets Inc.',
    title: 'Senior Software Engineer',
    sourceNote: null,
    status: 'extracted',
    createdAt: '2026-07-15T12:00:00.000Z',
    rawText: 'Requirements: 5+ years TypeScript. Nice to have: Fastify.',
  };
}

function requirementFixture(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: `fictional-requirement-${String(Math.random()).slice(2, 8)}`,
    kind: 'must_have',
    category: 'language',
    text: 'TypeScript experience',
    sourceQuote: '5+ years TypeScript',
    quoteVerified: true,
    confidence: 0.95,
    ...overrides,
  };
}

function runFixture(status: 'ok' | 'flagged'): PostingRequirementsResponse['run'] {
  return {
    id: 'fictional-run-id',
    promptId: 'extract-requirements@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    status,
    attempt: 1,
    inputTokens: 1200,
    outputTokens: 500,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 9000,
    createdAt: '2026-07-17T12:00:00.000Z',
  };
}

describe('posting requirements section', () => {
  beforeEach(() => {
    getPostingMock.mockReset();
    listApplicationsMock.mockReset();
    getPostingRequirementsMock.mockReset();
    getPostingMock.mockResolvedValue(detailFixture());
    listApplicationsMock.mockResolvedValue({ applications: [] });
    delete document.body.dataset.xssExecuted;
    clearNuxtData();
  });

  it('renders no section before the first extraction (run: null)', async () => {
    getPostingRequirementsMock.mockResolvedValue({ run: null, requirements: [] });
    const wrapper = await mountSuspended(PostingDetailPage);
    expect(wrapper.find('[data-testid="requirements-section"]').exists()).toBe(false);
  });

  it('renders no section when the requirements fetch fails (degrade, never block the posting)', async () => {
    getPostingRequirementsMock.mockRejectedValue(new Error('api down'));
    const wrapper = await mountSuspended(PostingDetailPage);
    expect(wrapper.find('[data-testid="requirements-section"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="posting-raw"]').text()).toContain('TypeScript');
  });

  it('ok run: list + telemetry, no banner, no unverified markers', async () => {
    getPostingRequirementsMock.mockResolvedValue({
      run: runFixture('ok'),
      requirements: [
        requirementFixture(),
        requirementFixture({
          kind: 'nice_to_have',
          category: 'framework',
          text: 'Fastify familiarity',
          sourceQuote: 'Nice to have: Fastify',
          confidence: 0.8,
        }),
      ],
    });

    const wrapper = await mountSuspended(PostingDetailPage);
    const section = wrapper.get('[data-testid="requirements-section"]');
    expect(section.findAll('li')).toHaveLength(2);
    expect(section.text()).toContain('TypeScript experience');
    expect(section.text()).toContain('nice to have');
    expect(wrapper.find('[data-testid="extraction-flagged"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="quote-unverified"]')).toHaveLength(0);
    const telemetry = wrapper.get('[data-testid="extraction-telemetry"]').text();
    expect(telemetry).toContain('mock-sonnet');
    expect(telemetry).toContain('extract-requirements@v1');
    expect(telemetry).toContain('1200 in / 500 out');
  });

  it('flagged run: role=alert banner with the unverified count; markers exactly on false rows, null rows unmarked', async () => {
    getPostingRequirementsMock.mockResolvedValue({
      run: runFixture('flagged'),
      requirements: [
        requirementFixture(),
        requirementFixture({
          text: 'fabricated one',
          sourceQuote: 'never in',
          quoteVerified: false,
        }),
        requirementFixture({ text: 'legacy row', quoteVerified: null }),
      ],
    });

    const wrapper = await mountSuspended(PostingDetailPage);
    const banner = wrapper.get('[data-testid="extraction-flagged"]');
    expect(banner.attributes('role')).toBe('alert');
    expect(banner.text()).toContain('1 of 3 quotes could not be verified');
    const markers = wrapper.findAll('[data-testid="quote-unverified"]');
    expect(markers).toHaveLength(1);
    // The marker sits inside the fabricated row's <li>, not the others.
    const flaggedItem = wrapper
      .findAll('li')
      .find((item) => item.find('[data-testid="quote-unverified"]').exists());
    expect(flaggedItem?.text()).toContain('fabricated one');
  });

  it('hostile requirement text and sourceQuote render INERT (same law as rawText)', async () => {
    const payload =
      '<script>document.body.dataset.xssExecuted = "fictional-marker"</script>' +
      '<img src=x onerror="document.body.dataset.xssExecuted = \'fictional-marker\'">';
    getPostingRequirementsMock.mockResolvedValue({
      run: runFixture('flagged'),
      requirements: [
        requirementFixture({ text: payload, sourceQuote: payload, quoteVerified: false }),
      ],
    });

    const wrapper = await mountSuspended(PostingDetailPage);
    const quote = wrapper.get('.requirement-quote');
    expect(quote.element.children.length).toBe(0);
    expect(quote.element.textContent).toBe(payload);
    expect(document.body.dataset.xssExecuted).toBeUndefined();
  });
});
