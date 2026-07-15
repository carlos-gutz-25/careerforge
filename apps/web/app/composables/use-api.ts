import type {
  LoginBody,
  LoginResponse,
  Posting,
  PostingDetail,
  PostingIngestBody,
  PostingIngestResponse,
  PostingListResponse,
  PostingStatusUpdateBody,
  ProfileResponse,
  SessionUser,
} from '@careerforge/core';

/**
 * The typed API client (M0-10). Types come from packages/core ONLY — the
 * same zod-inferred contracts apps/api enforces on the wire; type-only
 * imports keep core's zod out of the bundle (the API validates at its
 * boundary; re-parsing trusted own-API responses buys nothing).
 *
 * `credentials: 'include'` sends/accepts the HttpOnly cf_session cookie.
 * CSRF: the browser attaches `Origin` to every fetch mutation on its own;
 * the API rejects mismatches against WEB_APP_ORIGIN (ADR-0007) — the SPA
 * sends no token and must never route mutations through GETs.
 *
 * 401 discipline (README): any 401 outside /auth/login means the session is
 * absent/expired/revoked — the interceptor clears auth state and sends the
 * user to /login with the current location as the (validated) redirect
 * target. A login 401 is a wrong password and stays with the login form.
 */
export function useApi() {
  const config = useRuntimeConfig();

  const request = $fetch.create({
    baseURL: config.public.apiBase,
    credentials: 'include',
    async onResponseError({ request: rawRequest, response }) {
      const path = typeof rawRequest === 'string' ? rawRequest : rawRequest.url;
      if (response.status === 401 && !path.includes('/auth/login')) {
        useSessionUser().value = null;
        const route = useRoute();
        if (route.path !== '/login') {
          await navigateTo({ path: '/login', query: { redirect: route.fullPath } });
        }
      }
    },
  });

  async function call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && 'data' in error) {
        const fetchError = error as { status?: number; data?: unknown };
        throw toApiError(fetchError.status ?? 0, fetchError.data);
      }
      throw error;
    }
  }

  return {
    login: (body: LoginBody) =>
      call(() => request<LoginResponse>('/auth/login', { method: 'POST', body })),
    logout: () => call(() => request<null>('/auth/logout', { method: 'POST' })),
    me: () => call(() => request<SessionUser>('/auth/me')),
    getProfile: () => call(() => request<ProfileResponse>('/profile')),
    // Postings (M1-02). rawText rides exactly two wires: the ingest REQUEST
    // and the detail RESPONSE — the list and PATCH payloads are metadata
    // only, by API contract. The paste body is a dumb pipe: callers pass
    // rawText exactly as entered, no client-side trim/normalization.
    listPostings: () => call(() => request<PostingListResponse>('/postings')),
    getPosting: (id: string) => call(() => request<PostingDetail>(`/postings/${id}`)),
    createPosting: (body: PostingIngestBody) =>
      call(() => request<PostingIngestResponse>('/postings', { method: 'POST', body })),
    updatePostingStatus: (id: string, body: PostingStatusUpdateBody) =>
      call(() => request<Posting>(`/postings/${id}`, { method: 'PATCH', body })),
  };
}
