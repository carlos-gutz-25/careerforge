// The M0-10 acceptance-criterion test: the global auth guard, exercised in
// the real Nuxt runtime (`nuxt` vitest environment) with the API composable
// mocked — no network, fictional identities only.
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';

import authGuard from '../app/middleware/auth.global.ts';
import { useSessionUser } from '../app/composables/use-auth.ts';
import { ApiError } from '../app/utils/api-error.ts';

const { navigateToMock, meMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
  meMock: vi.fn(),
}));

mockNuxtImport('navigateTo', () => navigateToMock);
mockNuxtImport('useApi', () => () => ({ me: meMock }));

const route = (fullPath: string): RouteLocationNormalized =>
  ({ path: fullPath.split('?')[0], fullPath }) as RouteLocationNormalized;

const run = (to: string) => authGuard(route(to), route('/somewhere-else'));

describe('auth.global middleware', () => {
  beforeEach(() => {
    navigateToMock.mockReset();
    meMock.mockReset();
    useSessionUser().value = undefined;
  });

  it('redirects an unauthenticated visit to /login, preserving the target', async () => {
    meMock.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'authentication required'));

    await run('/profile?tab=skills');

    expect(meMock).toHaveBeenCalledTimes(1);
    expect(navigateToMock).toHaveBeenCalledWith({
      path: '/login',
      query: { redirect: '/profile?tab=skills' },
    });
  });

  it('resolves the session against the server exactly once, then lets an authenticated visit pass', async () => {
    meMock.mockResolvedValue({ id: 'fictional-id', email: 'alex.rivera.example@example.com' });

    await run('/');
    await run('/');

    expect(meMock).toHaveBeenCalledTimes(1);
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('bounces an already-authenticated user off /login', async () => {
    useSessionUser().value = { id: 'fictional-id', email: 'alex.rivera.example@example.com' };

    await run('/login');

    expect(meMock).not.toHaveBeenCalled();
    expect(navigateToMock).toHaveBeenCalledWith('/');
  });

  it('lets an unauthenticated user reach /login (no redirect loop)', async () => {
    meMock.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'authentication required'));

    await run('/login');

    expect(navigateToMock).not.toHaveBeenCalled();
  });
});
