// AppThemeToggle behavior (M8-06): three-state cycle system→light→dark→system,
// each choice reflected onto <html data-theme> (which pins color-scheme, which
// light-dark() resolves against) and persisted to localStorage.
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';

import AppThemeToggle from '../app/components/AppThemeToggle.vue';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('AppThemeToggle (M8-06)', () => {
  it('exposes the accessible toggle contract', async () => {
    const wrapper = await mountSuspended(AppThemeToggle);
    const button = wrapper.get('[data-testid="theme-toggle"]');
    expect(button.attributes('type')).toBe('button');
    expect(button.attributes('aria-label')).toContain('Theme:');
  });

  it('cycles system → light → dark → system, reflecting data-theme + storage', async () => {
    const wrapper = await mountSuspended(AppThemeToggle);
    const root = document.documentElement;
    const button = wrapper.get('[data-testid="theme-toggle"]');

    // Fresh mount, empty storage → System, no override attribute.
    expect(wrapper.text()).toContain('System');
    expect(root.hasAttribute('data-theme')).toBe(false);

    await button.trigger('click');
    expect(wrapper.text()).toContain('Light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('careerforge-theme')).toBe('light');

    await button.trigger('click');
    expect(wrapper.text()).toContain('Dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('careerforge-theme')).toBe('dark');

    await button.trigger('click');
    expect(wrapper.text()).toContain('System');
    // 'system' clears the override so tokens.css color-scheme follows the OS.
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('careerforge-theme')).toBe('system');
  });

  it('restores a persisted choice on mount', async () => {
    localStorage.setItem('careerforge-theme', 'dark');
    const wrapper = await mountSuspended(AppThemeToggle);
    expect(wrapper.text()).toContain('Dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
