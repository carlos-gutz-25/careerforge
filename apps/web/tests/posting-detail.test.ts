// Posting detail component tests (M1-02, RISKS S-02): the escaped-rendering
// AC at component level — a live payload renders INERT. The full-stack proof
// (real browser, real API, ingest → render) is e2e/postings-xss.spec.ts;
// this pins the rendering path in fast feedback. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostingDetail } from '@careerforge/core';

import PostingDetailPage from '../app/pages/postings/[id].vue';
import { ApiError } from '../app/utils/api-error.ts';

const { getPostingMock, updateStatusMock, routeState } = vi.hoisted(() => ({
  getPostingMock: vi.fn(),
  updateStatusMock: vi.fn(),
  routeState: {
    params: { id: 'fictional-posting-id' } as Record<string, string>,
    query: {} as Record<string, unknown>,
  },
}));

mockNuxtImport('useApi', () => () => ({
  getPosting: getPostingMock,
  updatePostingStatus: updateStatusMock,
}));
mockNuxtImport('useRoute', () => () => ({
  path: '/postings/fictional-posting-id',
  fullPath: '/postings/fictional-posting-id',
  params: routeState.params,
  query: routeState.query,
}));

// A live payload: script execution marker, event-handler injection, and the
// whitespace shapes (newlines, indentation, tab) that pre-wrap must preserve.
const HOSTILE_RAW_TEXT = [
  '<script>document.body.dataset.xssExecuted = "fictional-marker"</script>',
  'Senior Software Engineer — Fictional Widgets Inc.',
  '  indented requirement line',
  '<img src=x onerror="document.body.dataset.xssExecuted = \'fictional-marker\'">',
  '\tTab-prefixed line & <b>bold-looking</b> text.  ',
].join('\n');

function detailFixture(overrides: Partial<PostingDetail> = {}): PostingDetail {
  return {
    id: 'fictional-posting-id',
    company: 'Fictional Widgets Inc.',
    title: 'Senior Software Engineer',
    sourceNote: null,
    status: 'new',
    createdAt: '2026-07-15T12:00:00.000Z',
    rawText: HOSTILE_RAW_TEXT,
    ...overrides,
  };
}

describe('posting detail page', () => {
  beforeEach(() => {
    getPostingMock.mockReset();
    updateStatusMock.mockReset();
    routeState.query = {};
    delete document.body.dataset.xssExecuted;
    // useAsyncData caches by key across mounts in the shared nuxt test app.
    clearNuxtData();
  });

  it('renders a hostile payload INERT: text node only, byte-identical, nothing executes', async () => {
    getPostingMock.mockResolvedValue(detailFixture());

    const wrapper = await mountSuspended(PostingDetailPage);
    const raw = wrapper.get('[data-testid="posting-raw"]');

    // Interpolation produces a text node — the payload must not become
    // elements. Zero child elements is stronger than "no script tag".
    expect(raw.element.children.length).toBe(0);
    expect(raw.element.querySelector('script, img, b')).toBeNull();

    // Byte-identical text content: escaping must not alter the payload.
    expect(raw.element.textContent).toBe(HOSTILE_RAW_TEXT);

    // Neither the <script> body nor the onerror handler ran.
    expect(document.body.dataset.xssExecuted).toBeUndefined();

    // The newline-preservation mechanism is CSS pre-wrap on a <pre> — never
    // \n → <br> conversion (which would show up as child elements above).
    expect(raw.element.tagName).toBe('PRE');
    expect(raw.classes()).toContain('posting-raw');
  });

  it('archives via the server response: button PATCHes and re-renders the returned status', async () => {
    getPostingMock.mockResolvedValue(detailFixture());
    updateStatusMock.mockResolvedValue({
      id: 'fictional-posting-id',
      company: 'Fictional Widgets Inc.',
      title: 'Senior Software Engineer',
      sourceNote: null,
      status: 'archived',
      createdAt: '2026-07-15T12:00:00.000Z',
    });

    const wrapper = await mountSuspended(PostingDetailPage);
    await wrapper.get('button').trigger('click');
    await vi.waitFor(() => expect(updateStatusMock).toHaveBeenCalled());
    await new Promise((settle) => setTimeout(settle, 0));

    expect(updateStatusMock).toHaveBeenCalledWith('fictional-posting-id', { status: 'archived' });
    expect(wrapper.text()).toContain('archived');
    expect(wrapper.get('button').text()).toBe('Unarchive');
    // rawText survives the metadata-only PATCH response.
    expect(wrapper.get('[data-testid="posting-raw"]').element.textContent).toBe(HOSTILE_RAW_TEXT);
  });

  it('surfaces the API transition error message as received', async () => {
    getPostingMock.mockResolvedValue(detailFixture());
    updateStatusMock.mockRejectedValue(
      new ApiError(
        409,
        'INVALID_STATUS_TRANSITION',
        'posting status changed concurrently — reload',
      ),
    );

    const wrapper = await mountSuspended(PostingDetailPage);
    await wrapper.get('button').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[role="alert"]').text()).toBe(
        'posting status changed concurrently — reload',
      ),
    );
  });

  it('shows the not-found state on a 404', async () => {
    getPostingMock.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'posting not found'));

    const wrapper = await mountSuspended(PostingDetailPage);

    expect(wrapper.get('[role="alert"]').text()).toContain('Posting not found');
  });

  it('shows the duplicate-paste notice only when navigated with the duplicate flag', async () => {
    getPostingMock.mockResolvedValue(detailFixture());
    routeState.query = { duplicate: 'true' };

    const withFlag = await mountSuspended(PostingDetailPage);
    expect(withFlag.get('[role="status"]').text()).toContain('already pasted');
  });

  it('shows no duplicate notice on a plain visit', async () => {
    getPostingMock.mockResolvedValue(detailFixture());

    const wrapper = await mountSuspended(PostingDetailPage);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
