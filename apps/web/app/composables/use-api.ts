import type {
  Application,
  ApplicationCreateBody,
  ApplicationCreateResponse,
  ApplicationDetail,
  ApplicationEvent,
  ApplicationEventCreateBody,
  ApplicationListResponse,
  ApplicationStage,
  ApplicationStageUpdateBody,
  FitReportGapsResponse,
  FitReportPlanResponse,
  FitReportResponse,
  FitReviewBody,
  FitReviewResponse,
  GapOverrideBody,
  GapResponse,
  LoginBody,
  LoginResponse,
  PlanItemPatchBody,
  PlanItemPatchResponse,
  PlanReviewBody,
  PlanReviewResponse,
  Posting,
  PostingDetail,
  PostingExtractResponse,
  PostingFitResponse,
  PostingIngestBody,
  PostingIngestResponse,
  PostingListResponse,
  PostingRequirementsResponse,
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
    // Extraction results (M1-06). requirement text and sourceQuote are
    // posting-DERIVED and just as UNTRUSTED as rawText: render escaped only
    // ({{ }} interpolation), never as markup.
    getPostingRequirements: (id: string) =>
      call(() => request<PostingRequirementsResponse>(`/postings/${id}/requirements`)),
    // Extraction trigger (M1-10, the owed M1-06 surface). Body-less POST =
    // plain cached-if-possible extraction; force is DELIBERATELY not exposed
    // here — a paid re-extraction stays an explicit CLI/curl act. The call
    // can run 10–20 s: the page shows a pending state and fires once.
    extractPosting: (id: string) =>
      call(() => request<PostingExtractResponse>(`/postings/${id}/extract`, { method: 'POST' })),
    // Fit reports (M1-10). Scoring is deterministic and LLM-free; POST
    // always scores fresh and APPENDS, GET serves the latest report. Quote
    // fields are posting-derived and render escaped only, like rawText.
    getPostingFit: (id: string) => call(() => request<PostingFitResponse>(`/postings/${id}/fit`)),
    scorePostingFit: (id: string) =>
      call(() => request<FitReportResponse>(`/postings/${id}/fit`, { method: 'POST' })),
    reviewFitReport: (id: string, body: FitReviewBody) =>
      call(() => request<FitReviewResponse>(`/fit-reports/${id}/review`, { method: 'POST', body })),
    // Gap classifications (M1-11), report-scoped. requirementText and
    // rationale are posting-derived — escaped interpolation only. PATCH is
    // A2 FULL REPLACEMENT (note absent/null clears the stored note;
    // classification null reverts to the engine value).
    getFitReportGaps: (reportId: string) =>
      call(() => request<FitReportGapsResponse>(`/fit-reports/${reportId}/gaps`)),
    overrideGap: (gapId: string, body: GapOverrideBody) =>
      call(() => request<GapResponse>(`/gaps/${gapId}`, { method: 'PATCH', body })),
    // Improvement plans (M1-12), report-scoped (pin-to-report). Drafting is
    // review-gated and a PAID LLM call (10-20 s): the section fires once and
    // shows a pending state; an existing plan is served 200 with no call.
    // action text is LLM-generated and gap fields posting-derived — escaped
    // interpolation only, exactly like requirement text.
    getFitReportPlan: (reportId: string) =>
      call(() => request<FitReportPlanResponse>(`/fit-reports/${reportId}/improvement-plan`)),
    draftImprovementPlan: (reportId: string) =>
      call(() =>
        request<FitReportPlanResponse>(`/fit-reports/${reportId}/improvement-plan`, {
          method: 'POST',
        }),
      ),
    reviewImprovementPlan: (planId: string, body: PlanReviewBody) =>
      call(() =>
        request<PlanReviewResponse>(`/improvement-plans/${planId}/review`, {
          method: 'POST',
          body,
        }),
      ),
    // A2 full replacement of the two mutable fields; action/gap/position are
    // immutable draft content by API contract.
    updatePlanItem: (itemId: string, body: PlanItemPatchBody) =>
      call(() =>
        request<PlanItemPatchResponse>(`/plan-items/${itemId}`, { method: 'PATCH', body }),
      ),
    // Applications (M1-03). Payloads never carry posting rawText — the list
    // and detail responses embed a company/title posting summary only, by
    // API contract (spec-tripwire-pinned server-side).
    listApplications: (query?: { stage?: ApplicationStage; postingId?: string }) =>
      call(() => request<ApplicationListResponse>('/applications', { query })),
    getApplication: (id: string) => call(() => request<ApplicationDetail>(`/applications/${id}`)),
    createApplication: (body: ApplicationCreateBody) =>
      call(() => request<ApplicationCreateResponse>('/applications', { method: 'POST', body })),
    updateApplicationStage: (id: string, body: ApplicationStageUpdateBody) =>
      call(() => request<Application>(`/applications/${id}`, { method: 'PATCH', body })),
    addApplicationEvent: (id: string, body: ApplicationEventCreateBody) =>
      call(() => request<ApplicationEvent>(`/applications/${id}/events`, { method: 'POST', body })),
  };
}
