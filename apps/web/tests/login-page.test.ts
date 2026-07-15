// Login page component tests (mountSuspended in the real Nuxt runtime).
// Credentials are fictional; useAuth is mocked — no network.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from '../app/pages/login.vue';
import { ApiError } from '../app/utils/api-error.ts';

const { navigateToMock, loginMock, routeState } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
  loginMock: vi.fn(),
  routeState: { query: {} as Record<string, unknown> },
}));

mockNuxtImport('navigateTo', () => navigateToMock);
mockNuxtImport('useAuth', () => () => ({ login: loginMock }));
mockNuxtImport('useRoute', () => () => ({
  path: '/login',
  fullPath: '/login',
  query: routeState.query,
}));

async function submitLogin() {
  const wrapper = await mountSuspended(LoginPage);
  await wrapper.find('input[name="email"]').setValue('alex.rivera.example@example.com');
  await wrapper.find('input[name="password"]').setValue('fictional-test-password');
  await wrapper.find('form').trigger('submit');
  // Let the async submit handler settle.
  await vi.waitFor(() => expect(loginMock).toHaveBeenCalled());
  await new Promise((resolveSettled) => setTimeout(resolveSettled, 0));
  return wrapper;
}

describe('login page', () => {
  beforeEach(() => {
    navigateToMock.mockReset();
    loginMock.mockReset();
    routeState.query = {};
  });

  it('shows the invalid-credentials message on a 401 and stays put', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'authentication required'));

    const wrapper = await submitLogin();

    expect(wrapper.get('[role="alert"]').text()).toBe('Invalid email or password.');
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('shows the rate-limit message on a 429', async () => {
    loginMock.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'too many login attempts'));

    const wrapper = await submitLogin();

    expect(wrapper.get('[role="alert"]').text()).toContain('Too many attempts');
  });

  it('navigates to a validated internal ?redirect= target on success', async () => {
    loginMock.mockResolvedValue(undefined);
    routeState.query = { redirect: '/profile?tab=skills' };

    await submitLogin();

    expect(navigateToMock).toHaveBeenCalledWith('/profile?tab=skills');
  });

  it('falls back to / when ?redirect= is an absolute URL (open-redirect pin, approval amendment)', async () => {
    loginMock.mockResolvedValue(undefined);
    routeState.query = { redirect: 'https://evil.example/phish' };

    await submitLogin();

    expect(navigateToMock).toHaveBeenCalledWith('/');
  });
});
