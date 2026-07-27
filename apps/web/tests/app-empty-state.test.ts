// AppEmptyState primitive (M8-07): a centered, muted placeholder. Default slot
// is the message; the optional #action slot renders a call to action.
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import AppEmptyState from '../app/components/AppEmptyState.vue';

describe('AppEmptyState (M8-07)', () => {
  it('renders the message slot without an action wrapper', async () => {
    const wrapper = await mountSuspended(AppEmptyState, {
      slots: { default: 'No postings yet.' },
    });
    expect(wrapper.get('.app-empty-message').text()).toBe('No postings yet.');
    expect(wrapper.find('.app-empty-action').exists()).toBe(false);
  });

  it('renders the action slot when provided', async () => {
    const wrapper = await mountSuspended(AppEmptyState, {
      slots: {
        default: 'Nothing here.',
        action: '<button type="button">Add one</button>',
      },
    });
    const action = wrapper.get('.app-empty-action');
    expect(action.find('button').exists()).toBe(true);
    expect(action.text()).toContain('Add one');
  });
});
