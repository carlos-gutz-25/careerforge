// Paste form component tests (M1-02) — the four kickoff pins. All data
// fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PostingNewPage from '../app/pages/postings/new.vue';
import { ApiError } from '../app/utils/api-error.ts';

const { createPostingMock, navigateToMock } = vi.hoisted(() => ({
  createPostingMock: vi.fn(),
  navigateToMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({ createPosting: createPostingMock }));
mockNuxtImport('navigateTo', () => navigateToMock);

const STORED_POSTING = {
  id: 'fictional-stored-id',
  company: 'Fictional Widgets Inc.',
  title: null,
  sourceNote: null,
  status: 'new',
  createdAt: '2026-07-15T12:00:00.000Z',
};

async function submitPaste(rawText: string) {
  const wrapper = await mountSuspended(PostingNewPage);
  await wrapper.get('textarea[name="rawText"]').setValue(rawText);
  await wrapper.get('form').trigger('submit');
  await vi.waitFor(() => expect(createPostingMock).toHaveBeenCalled());
  await new Promise((settle) => setTimeout(settle, 0));
  return wrapper;
}

describe('paste form', () => {
  beforeEach(() => {
    createPostingMock.mockReset();
    navigateToMock.mockReset();
  });

  it('pin 1 — dumb pipe: rawText is submitted EXACTLY as entered, no trim, no normalization', async () => {
    createPostingMock.mockResolvedValue({ posting: STORED_POSTING, duplicate: false });
    const pasted = '  padded fictional posting\n\n  indented line\ttabbed  \n';

    await submitPaste(pasted);

    expect(createPostingMock).toHaveBeenCalledWith({
      rawText: pasted,
      company: undefined,
      title: undefined,
      sourceNote: undefined,
    });
  });

  it('pin 3 — created: navigates straight to the detail view (server GET renders it; no client echo)', async () => {
    createPostingMock.mockResolvedValue({ posting: STORED_POSTING, duplicate: false });

    await submitPaste('fictional posting body');

    expect(navigateToMock).toHaveBeenCalledWith('/postings/fictional-stored-id');
  });

  it("pin 2 — duplicate: renders the SERVER's boolean as the duplicate route, landing on the STORED posting", async () => {
    createPostingMock.mockResolvedValue({ posting: STORED_POSTING, duplicate: true });

    await submitPaste('fictional posting body');

    expect(navigateToMock).toHaveBeenCalledWith({
      path: '/postings/fictional-stored-id',
      query: { duplicate: 'true' },
    });
  });

  it('pin 4 — errors show the API message as received, with no client-added preview of the paste', async () => {
    createPostingMock.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'body/rawText: too_big'),
    );
    const pasted = 'FICTIONAL-PASTE-MARKER-5a1d oversized body';

    const wrapper = await submitPaste(pasted);

    // Exactly the server's value-free message — nothing appended, nothing
    // quoted from the textarea.
    expect(wrapper.get('[role="alert"]').text()).toBe('body/rawText: too_big');
    expect(navigateToMock).not.toHaveBeenCalled();
    // The pasted text exists in the DOM only as the textarea's live value,
    // never as rendered content (textContent) anywhere on the page.
    expect(wrapper.element.textContent).not.toContain('FICTIONAL-PASTE-MARKER-5a1d');
  });

  it('sends non-empty metadata as typed (metadata is trimmed server-side, not here)', async () => {
    createPostingMock.mockResolvedValue({ posting: STORED_POSTING, duplicate: false });

    const wrapper = await mountSuspended(PostingNewPage);
    await wrapper.get('textarea[name="rawText"]').setValue('fictional posting body');
    await wrapper.get('input[name="company"]').setValue('  Fictional Widgets Inc.  ');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(createPostingMock).toHaveBeenCalled());

    expect(createPostingMock).toHaveBeenCalledWith({
      rawText: 'fictional posting body',
      company: '  Fictional Widgets Inc.  ',
      title: undefined,
      sourceNote: undefined,
    });
  });
});
