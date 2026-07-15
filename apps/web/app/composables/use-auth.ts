import type { SessionUser } from '@careerforge/core';

/**
 * Client-side auth state. The cf_session cookie is HttpOnly — invisible to
 * JS by design — so the server is the only source of truth: `undefined`
 * means "not asked yet" (resolve() calls GET /auth/me once), `null` means
 * "asked, unauthenticated". No Pinia yet: one useState key is all the state
 * the shell has (revisit at M1 when list/detail state lands).
 */
export function useSessionUser() {
  return useState<SessionUser | null | undefined>('auth:user', () => undefined);
}

export function useAuth() {
  const user = useSessionUser();
  const api = useApi();

  async function resolve(): Promise<void> {
    if (user.value !== undefined) return;
    try {
      user.value = await api.me();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        user.value = null;
        return;
      }
      throw error;
    }
  }

  async function login(body: { email: string; password: string }): Promise<void> {
    const response = await api.login(body);
    user.value = response.user;
  }

  async function logout(): Promise<void> {
    try {
      await api.logout();
    } finally {
      user.value = null;
      await navigateTo('/login');
    }
  }

  return { user, resolve, login, logout };
}
