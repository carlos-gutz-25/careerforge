// Criteria tuning page tests (M4-02): observation-voice suggestion cards with
// escaped evidence rows, the insufficient-data state, and the confirm flow that
// pins the criteria CAS and refetches. All data fictional (Alex Rivera).
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CriteriaSuggestionsResponse } from '@careerforge/core';

import CriteriaTuningPage from '../app/pages/criteria/index.vue';

const { getSuggestionsMock, listAdjustmentsMock, confirmMock } = vi.hoisted(() => ({
  getSuggestionsMock: vi.fn(),
  listAdjustmentsMock: vi.fn(),
  confirmMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getCriteriaSuggestions: getSuggestionsMock,
  listCriteriaAdjustments: listAdjustmentsMock,
  confirmCriteriaAdjustment: confirmMock,
}));

const PIN = '2026-07-25T00:00:00.000Z';

function okSuggestions(): CriteriaSuggestionsResponse {
  return {
    status: 'ok',
    criteriaUpdatedAt: PIN,
    totals: {
      applications: 12,
      exposed: 10,
      resolved: 10,
      analyzable: 8,
      inFlight: 1,
      withdrawnCensored: 1,
      withoutRequirements: 2,
    },
    thresholds: {
      minResolvedAnalyzable: 8,
      minMatchedCell: 4,
      minUnmatchedCell: 4,
      minCounterProgressed: 2,
    },
    suggestions: [
      {
        kind: 'remove_positive_signal',
        category: 'technologies',
        slug: 'go',
        evidence: {
          matched: { total: 4, progressed: 0 },
          unmatched: { total: 4, progressed: 2 },
          matchedPostings: [
            {
              applicationId: 'app-1',
              postingId: 'posting-1',
              company: 'Fictional Widgets Inc.',
              title: 'Staff Engineer',
              furthestStage: 'applied',
              outcome: 'rejected_before_screen',
            },
          ],
        },
      },
    ],
  };
}

function insufficient(): CriteriaSuggestionsResponse {
  return {
    status: 'insufficient_data',
    criteriaUpdatedAt: PIN,
    totals: {
      applications: 3,
      exposed: 2,
      resolved: 2,
      analyzable: 2,
      inFlight: 1,
      withdrawnCensored: 0,
      withoutRequirements: 0,
    },
    thresholds: {
      minResolvedAnalyzable: 8,
      minMatchedCell: 4,
      minUnmatchedCell: 4,
      minCounterProgressed: 2,
    },
    suggestions: [],
  };
}

describe('criteria tuning page', () => {
  beforeEach(() => {
    getSuggestionsMock.mockReset();
    listAdjustmentsMock.mockReset();
    confirmMock.mockReset();
    listAdjustmentsMock.mockResolvedValue({ adjustments: [] });
    clearNuxtData();
  });

  it('renders a suggestion card with observation voice and escaped evidence rows', async () => {
    getSuggestionsMock.mockResolvedValue(okSuggestions());

    const wrapper = await mountSuspended(CriteriaTuningPage);

    const card = wrapper.get('.criteria-card');
    expect(card.text()).toContain('Consider removing "go" from your technologies signals');
    // Observation voice: describes the numbers, disclaims causation.
    expect(card.text()).toContain('not a cause');
    expect(card.text()).toContain('Fictional Widgets Inc.');
    expect(card.text()).toContain('Staff Engineer');
    expect(card.text()).toContain('rejected before a screen');
    // Totals are disclosed.
    expect(wrapper.text()).toContain('12 applications tracked');
  });

  it('shows the insufficient-data state with the disclosed threshold, no cards', async () => {
    getSuggestionsMock.mockResolvedValue(insufficient());

    const wrapper = await mountSuspended(CriteriaTuningPage);

    expect(wrapper.text()).toContain('at least 8 analyzable applications');
    expect(wrapper.find('.criteria-card').exists()).toBe(false);
  });

  it('apply confirms with the pinned criteriaUpdatedAt and refetches', async () => {
    getSuggestionsMock.mockResolvedValue(okSuggestions());
    confirmMock.mockResolvedValue({
      adjustment: {
        id: 'adj-1',
        kind: 'remove_positive_signal',
        category: 'technologies',
        slug: 'go',
        evidence: okSuggestions().suggestions[0]!.evidence,
        createdAt: PIN,
      },
      criteria: { updatedAt: '2026-07-25T00:00:05.000Z' },
    });

    const wrapper = await mountSuspended(CriteriaTuningPage);
    await wrapper.get('.criteria-card button').trigger('click');
    await vi.waitFor(() =>
      expect(confirmMock).toHaveBeenCalledWith({
        kind: 'remove_positive_signal',
        category: 'technologies',
        slug: 'go',
        expectedUpdatedAt: PIN,
      }),
    );
    // Refetches both suggestions and the audit list after applying.
    expect(getSuggestionsMock.mock.calls.length).toBeGreaterThan(1);
    expect(wrapper.text()).toContain('Removed "go" from your criteria');
  });

  it('a 409 on apply surfaces the refreshed notice, never a blind retry', async () => {
    getSuggestionsMock.mockResolvedValue(okSuggestions());
    confirmMock.mockRejectedValue({ status: 409 });

    const wrapper = await mountSuspended(CriteriaTuningPage);
    await wrapper.get('.criteria-card button').trigger('click');
    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledOnce());
    await new Promise((settle) => setTimeout(settle, 0));

    expect(wrapper.text()).toContain('The data changed since these suggestions were shown');
  });
});
