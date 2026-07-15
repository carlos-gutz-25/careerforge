// Application detail component tests (M1-03): the event trail renders
// user-authored details INERT (interpolation — the rendering law is free
// even for non-hostile input), the stage control excludes the current stage
// (same-stage PATCH is a 409 by design), and every mutation re-fetches and
// renders SERVER truth. All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationDetail } from '@careerforge/core';

import ApplicationDetailPage from '../app/pages/applications/[id].vue';
import { ApiError } from '../app/utils/api-error.ts';

const { getApplicationMock, updateStageMock, addEventMock } = vi.hoisted(() => ({
  getApplicationMock: vi.fn(),
  updateStageMock: vi.fn(),
  addEventMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getApplication: getApplicationMock,
  updateApplicationStage: updateStageMock,
  addApplicationEvent: addEventMock,
}));
mockNuxtImport('useRoute', () => () => ({
  path: '/applications/fictional-application-id',
  fullPath: '/applications/fictional-application-id',
  params: { id: 'fictional-application-id' },
  query: {},
}));

// A live payload in a NOTE detail: user-authored text is not hostile, but
// the rendering law doesn't care — inert by construction, byte-identical.
const HOSTILE_NOTE = [
  '<script>document.body.dataset.xssExecuted = "fictional-marker"</script>',
  'Recruiter said: use <b>bold</b> claims & "quotes".',
  '  indented follow-up line',
].join('\n');

function detailFixture(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    id: 'fictional-application-id',
    postingId: 'fictional-posting-id',
    stage: 'considering',
    appliedOn: null,
    createdAt: '2026-07-15T12:00:00.000Z',
    posting: { company: 'Fictional Widgets Inc.', title: 'Senior Software Engineer' },
    events: [],
    ...overrides,
  };
}

/** The page sends browser-local today explicitly (the server default is
 *  UTC-today); the tests compute the same value the page does. */
function localToday(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

describe('application detail page', () => {
  beforeEach(() => {
    getApplicationMock.mockReset();
    updateStageMock.mockReset();
    addEventMock.mockReset();
    delete document.body.dataset.xssExecuted;
    // useAsyncData caches by key across mounts in the shared nuxt test app.
    clearNuxtData();
  });

  it('renders a hostile note detail INERT in the trail: text node, byte-identical, nothing executes', async () => {
    getApplicationMock.mockResolvedValue(
      detailFixture({
        events: [
          {
            id: 'fictional-event-id',
            kind: 'note',
            detail: HOSTILE_NOTE,
            occurredOn: '2026-07-14',
            createdAt: '2026-07-14T12:00:00.000Z',
          },
        ],
      }),
    );

    const wrapper = await mountSuspended(ApplicationDetailPage);
    const detail = wrapper.get('.event-detail');

    // Interpolation produces a text node — the payload must not become
    // elements (zero child elements is stronger than "no script tag").
    expect(detail.element.children.length).toBe(0);
    expect(detail.element.textContent).toBe(HOSTILE_NOTE);
    expect(document.body.dataset.xssExecuted).toBeUndefined();
  });

  it('renders the trail chronologically with the synthetic tracked-on head and system stage labels', async () => {
    getApplicationMock.mockResolvedValue(
      detailFixture({
        stage: 'applied',
        appliedOn: '2026-07-03',
        events: [
          {
            id: 'stage-event-id',
            kind: 'stage_change',
            detail: 'considering → applied',
            occurredOn: '2026-07-03',
            createdAt: '2026-07-03T12:00:00.000Z',
          },
          {
            id: 'note-event-id',
            kind: 'note',
            detail: 'Fictional recruiter replied.',
            occurredOn: '2026-07-14',
            createdAt: '2026-07-14T12:00:00.000Z',
          },
        ],
      }),
    );

    const wrapper = await mountSuspended(ApplicationDetailPage);
    const rows = wrapper.get('[data-testid="event-trail"]').findAll('.event-row');

    expect(rows).toHaveLength(3); // tracked-on head + two events, server order
    expect(rows[0]?.text()).toContain('created from the posting');
    expect(rows[1]?.text()).toContain('considering → applied');
    expect(rows[2]?.text()).toContain('Fictional recruiter replied.');
    expect(wrapper.get('[data-testid="application-stage"]').text()).toBe('applied');
    expect(wrapper.text()).toContain('applied 2026-07-03');
  });

  it('the stage select excludes the current stage (same-stage PATCH is a 409 by design)', async () => {
    getApplicationMock.mockResolvedValue(detailFixture({ stage: 'screen' }));

    const wrapper = await mountSuspended(ApplicationDetailPage);
    const options = wrapper
      .get('select[name="nextStage"]')
      .findAll('option')
      .map((option) => option.attributes('value'));

    expect(options).not.toContain('screen');
    expect(options).toContain('interview');
    expect(options).toContain('rejected');
  });

  it('updates the stage with the chosen date and re-renders SERVER truth via re-fetch', async () => {
    getApplicationMock.mockResolvedValue(detailFixture());
    updateStageMock.mockResolvedValue({
      id: 'fictional-application-id',
      postingId: 'fictional-posting-id',
      stage: 'applied',
      appliedOn: '2026-07-03',
      createdAt: '2026-07-15T12:00:00.000Z',
    });

    const wrapper = await mountSuspended(ApplicationDetailPage);
    getApplicationMock.mockResolvedValue(
      detailFixture({
        stage: 'applied',
        appliedOn: '2026-07-03',
        events: [
          {
            id: 'stage-event-id',
            kind: 'stage_change',
            detail: 'considering → applied',
            occurredOn: '2026-07-03',
            createdAt: '2026-07-15T13:00:00.000Z',
          },
        ],
      }),
    );
    await wrapper.get('select[name="nextStage"]').setValue('applied');
    await wrapper.get('input[name="stageDate"]').setValue('2026-07-03');
    await wrapper.get('form.stage-form').trigger('submit');
    await vi.waitFor(() => expect(updateStageMock).toHaveBeenCalled());
    await new Promise((settle) => setTimeout(settle, 0));

    expect(updateStageMock).toHaveBeenCalledWith('fictional-application-id', {
      stage: 'applied',
      occurredOn: '2026-07-03',
    });
    // Rendered from the re-fetched detail, not from client state.
    expect(getApplicationMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.get('[data-testid="application-stage"]').text()).toBe('applied');
    expect(wrapper.text()).toContain('considering → applied');
  });

  it('surfaces the API 409 message as received when the stage update conflicts', async () => {
    getApplicationMock.mockResolvedValue(detailFixture());
    updateStageMock.mockRejectedValue(
      new ApiError(
        409,
        'INVALID_STAGE_TRANSITION',
        'application stage changed concurrently — reload',
      ),
    );

    const wrapper = await mountSuspended(ApplicationDetailPage);
    await wrapper.get('select[name="nextStage"]').setValue('applied');
    await wrapper.get('form.stage-form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.get('[role="alert"]').text()).toBe(
        'application stage changed concurrently — reload',
      ),
    );
  });

  it('adds a note with kind/detail/date and re-fetches the trail', async () => {
    getApplicationMock.mockResolvedValue(detailFixture());
    addEventMock.mockResolvedValue({
      id: 'new-note-id',
      kind: 'note',
      detail: 'Fictional note body.',
      occurredOn: localToday(),
      createdAt: '2026-07-15T14:00:00.000Z',
    });

    const wrapper = await mountSuspended(ApplicationDetailPage);
    await wrapper.get('textarea[name="eventDetail"]').setValue('Fictional note body.');
    await wrapper.get('form.event-form').trigger('submit');
    await vi.waitFor(() => expect(addEventMock).toHaveBeenCalled());
    await new Promise((settle) => setTimeout(settle, 0));

    expect(addEventMock).toHaveBeenCalledWith('fictional-application-id', {
      kind: 'note',
      detail: 'Fictional note body.',
      occurredOn: localToday(),
    });
    expect(getApplicationMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The textarea clears after a successful add (ready for the next note).
    expect((wrapper.get('textarea[name="eventDetail"]').element as HTMLTextAreaElement).value).toBe(
      '',
    );
  });

  it('shows the not-found state on a 404', async () => {
    getApplicationMock.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'application not found'));

    const wrapper = await mountSuspended(ApplicationDetailPage);

    expect(wrapper.get('[role="alert"]').text()).toContain('Application not found');
  });
});
