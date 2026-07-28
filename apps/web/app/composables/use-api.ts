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
  CaseStudiesResponse,
  CaseStudyResponse,
  ConfirmCriteriaAdjustmentBody,
  CreateCaseStudyBody,
  ConfirmCriteriaAdjustmentResponse,
  CreateExerciseBody,
  CreateMasteryEvidenceBody,
  CriteriaAdjustmentsResponse,
  CriteriaSuggestionsResponse,
  ExercisePatchBody,
  ExerciseResponse,
  MasteryEvidenceResponse,
  FitReportGapsResponse,
  FitReportPlanResponse,
  FitReportResponse,
  FitReviewBody,
  FitReviewResponse,
  GapOverrideBody,
  GapResponse,
  InterviewPrepResponse,
  InterviewPrepReviewBody,
  InterviewPrepReviewResponse,
  CreateLearningPlanBody,
  LearningPlanListResponse,
  LearningPlanResponse,
  LearningPlanReviewBody,
  LearningPlanReviewResponse,
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
  CreateSkillUpgradeBody,
  RevokeSkillUpgradeBody,
  SkillUpgradeResponse,
  SkillUpgradeSuggestionsResponse,
  SkillUpgradesResponse,
  ResumeVariantReviewBody,
  ResumeVariantReviewResponse,
  FitReportResumeVariantResponse,
  ReviewQueueResponse,
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
    // Resume variants (M2-10), report-scoped (pin-to-report). Tailoring is
    // review-gated and a PAID LLM call (10-20 s): the section fires once and
    // shows a pending state; an existing variant is served 200 with no call.
    // reason text is LLM-generated and citation fields posting-derived —
    // escaped interpolation only, exactly like requirement text.
    getFitReportResumeVariant: (reportId: string) =>
      call(() =>
        request<FitReportResumeVariantResponse>(`/fit-reports/${reportId}/resume-variant`),
      ),
    draftResumeVariant: (reportId: string) =>
      call(() =>
        request<FitReportResumeVariantResponse>(`/fit-reports/${reportId}/resume-variant`, {
          method: 'POST',
        }),
      ),
    reviewResumeVariant: (variantId: string, body: ResumeVariantReviewBody) =>
      call(() =>
        request<ResumeVariantReviewResponse>(`/resume-variants/${variantId}/review`, {
          method: 'POST',
          body,
        }),
      ),
    // Export is a browser DOWNLOAD, not a typed JSON call: the 200 is raw
    // text/markdown. A raw fetch (credentials:'include' on the configured
    // CORS+cookie channel, never an <a href> that would ride SameSite nav
    // semantics) -> Blob -> object URL -> programmatic anchor. The system
    // writes no file; the browser save dialog is the only disk touch.
    exportResumeVariant: async (variantId: string): Promise<void> => {
      const response = await fetch(`${config.public.apiBase}/resume-variants/${variantId}/export`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw toApiError(response.status, body);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `resume-variant-${variantId}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    // Interview prep (M3-04), posting-scoped (the route resolves the
    // posting's LATEST fit report; pin-to-report at rest, UNIQUE per report).
    // Drafting is review-gated and a PAID LLM call (10-20 s): the section
    // fires once and shows a pending state; an existing prep is served 200
    // with no call (cached). Question/point text and joined display fields
    // are LLM/posting-derived — escaped interpolation only, like requirement
    // text. Review is the one-shot draft→reviewed action; notes never logged.
    getInterviewPrep: (postingId: string) =>
      call(() => request<InterviewPrepResponse>(`/postings/${postingId}/interview-prep`)),
    draftInterviewPrep: (postingId: string) =>
      call(() =>
        request<InterviewPrepResponse>(`/postings/${postingId}/interview-prep`, {
          method: 'POST',
        }),
      ),
    reviewInterviewPrep: (prepId: string, body: InterviewPrepReviewBody) =>
      call(() =>
        request<InterviewPrepReviewResponse>(`/interview-preps/${prepId}/review`, {
          method: 'POST',
          body,
        }),
      ),
    // Learning plans (M3-01), FREE-CREATE (plural by design, ADR-0013) from
    // selected gaps. Drafting is a PAID LLM call; each POST appends a run and
    // (on a citation-clean run) a fresh plan — there is no cache. The list is
    // meta-only; the detail embeds cited gaps + the plan's exercises + their
    // mastery evidence. Title/focus/gap fields are LLM/posting-derived —
    // escaped interpolation only, like requirement text. Review is the
    // one-shot draft→reviewed action; notes never logged.
    listLearningPlans: () => call(() => request<LearningPlanListResponse>('/learning-plans')),
    getLearningPlan: (id: string) =>
      call(() => request<LearningPlanResponse>(`/learning-plans/${id}`)),
    createLearningPlan: (body: CreateLearningPlanBody) =>
      call(() => request<LearningPlanResponse>('/learning-plans', { method: 'POST', body })),
    reviewLearningPlan: (id: string, body: LearningPlanReviewBody) =>
      call(() =>
        request<LearningPlanReviewResponse>(`/learning-plans/${id}/review`, {
          method: 'POST',
          body,
        }),
      ),
    // Exercises (M3-02), plan-scoped, deterministic CRUD (no LLM). create is
    // linked to a non-empty set of the plan's cited gaps (409 if a gap is not
    // in the plan); PATCH replaces the ONE mutable field (status — 409 on
    // status=complete without implemented+tested evidence, the M3-03 gate);
    // DELETE is the mis-create recourse (204, CASCADE clears gap links). title
    // is user-authored and UNTRUSTED on display — escaped interpolation only.
    createExercise: (body: CreateExerciseBody) =>
      call(() => request<ExerciseResponse>('/exercises', { method: 'POST', body })),
    updateExerciseStatus: (id: string, body: ExercisePatchBody) =>
      call(() => request<ExerciseResponse>(`/exercises/${id}`, { method: 'PATCH', body })),
    deleteExercise: (id: string) =>
      call(() => request<null>(`/exercises/${id}`, { method: 'DELETE' })),
    // Mastery evidence (M3-03), exercise-scoped, deterministic CRUD (no LLM).
    // create records that an exercise was done (404 if the exercise is not
    // owned; 400 on a future recordedOn); it is IMMUTABLE (no PATCH). DELETE is
    // the mis-create recourse (204) but the server delete-guard refuses removing
    // the last implemented/tested evidence of a `complete` exercise (409).
    // artifactUrl is user-authored and UNTRUSTED on display — escaped only.
    createMasteryEvidence: (body: CreateMasteryEvidenceBody) =>
      call(() => request<MasteryEvidenceResponse>('/mastery-evidence', { method: 'POST', body })),
    deleteMasteryEvidence: (id: string) =>
      call(() => request<null>(`/mastery-evidence/${id}`, { method: 'DELETE' })),
    // Review queue (M3-05), the spaced-review projection: DUE revisits over the
    // caller's completed exercises, recomputed from the server clock on every
    // GET (nothing stored, nothing goes stale). Read-only — completing a revisit
    // is the EXISTING createMasteryEvidence with kind 'revisited', after which
    // the next GET recomputes the ladder. Exercise titles are user-authored and
    // UNTRUSTED on display — escaped interpolation only.
    getReviewQueue: () => call(() => request<ReviewQueueResponse>('/review-queue')),
    // Case-study drafts (M4-01), generated deterministically (no LLM) from a
    // COMPLETED exercise + its mastery evidence. The list is a picker (markdown
    // omitted); the detail carries renderedMarkdown. create is NOT
    // idempotent-create — a repeat POST while unpublished RE-RENDERS and fully
    // replaces the stored draft (200), an omitted title RESETS to the exercise
    // title (OD-1 full-replacement); 201 on first create, 409 once published or
    // the exercise is not complete. publish is a one-way CAS flip draft→published
    // that locks refresh (409 if already published). delete is the mis-publish
    // recourse (204 at any status). title / exerciseTitle / renderedMarkdown are
    // user/template-derived and UNTRUSTED — escaped {{ }} text / <pre> only, the
    // markdown is NEVER parsed as markup.
    listCaseStudies: () => call(() => request<CaseStudiesResponse>('/case-studies')),
    getCaseStudy: (id: string) => call(() => request<CaseStudyResponse>(`/case-studies/${id}`)),
    createCaseStudy: (body: CreateCaseStudyBody) =>
      call(() => request<CaseStudyResponse>('/case-studies', { method: 'POST', body })),
    publishCaseStudy: (id: string) =>
      call(() => request<CaseStudyResponse>(`/case-studies/${id}/publish`, { method: 'POST' })),
    deleteCaseStudy: (id: string) =>
      call(() => request<null>(`/case-studies/${id}`, { method: 'DELETE' })),
    // Export is a browser DOWNLOAD of the stored rendered_markdown byte-for-byte
    // (no status gate — the draft IS the product). Same raw-fetch→Blob→anchor
    // helper as exportResumeVariant (credentials:'include' on the CORS+cookie
    // channel, never an <a href> that would ride SameSite nav semantics).
    exportCaseStudy: async (id: string): Promise<void> => {
      const response = await fetch(`${config.public.apiBase}/case-studies/${id}/export`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw toApiError(response.status, body);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `case-study-${id}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
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
    // Criteria tuning (M4-02). Outcome data suggests REMOVING a signal slug;
    // applied only on confirmation (human in the loop). GET recomputes per
    // request. company/title in the evidence are user-curated posting metadata —
    // escaped interpolation only. confirm sends the natural-id triple + the
    // criteriaUpdatedAt pin GET returned (CAS: a stale pin is a 409).
    getCriteriaSuggestions: () =>
      call(() => request<CriteriaSuggestionsResponse>('/criteria-suggestions')),
    confirmCriteriaAdjustment: (body: ConfirmCriteriaAdjustmentBody) =>
      call(() =>
        request<ConfirmCriteriaAdjustmentResponse>('/criteria-adjustments', {
          method: 'POST',
          body,
        }),
      ),
    listCriteriaAdjustments: () =>
      call(() => request<CriteriaAdjustmentsResponse>('/criteria-adjustments')),
    // Skill upgrades (M3-06), deterministic and LLM-free (the review-queue /
    // criteria-suggestions projection class). Suggestions are recomputed on every
    // GET (nothing stored, nothing stale): completed, fully-evidenced exercises
    // whose evidence would earn a suggestible skill a `solid` grant. confirm sends
    // ONLY the two ids; the server re-derives the whole grant from the exercise +
    // profile state (zero client trust) — 404 skill/exercise, 409 not derivable /
    // already active. The audit list is ALL grants (active + revoked) with their
    // evidence trail and a derived `detached` flag. revoke is the correction
    // recourse (effective level falls back to declared — append-only, never a
    // delete): 404 unknown/foreign, 409 already revoked; the note is UNTRUSTED and
    // never logged. skill/requirement/exercise/artifact text are user/posting-
    // derived — escaped interpolation only on display, like requirement text.
    getSkillUpgradeSuggestions: () =>
      call(() => request<SkillUpgradeSuggestionsResponse>('/skill-upgrade-suggestions')),
    createSkillUpgrade: (body: CreateSkillUpgradeBody) =>
      call(() => request<SkillUpgradeResponse>('/skill-upgrades', { method: 'POST', body })),
    listSkillUpgrades: () => call(() => request<SkillUpgradesResponse>('/skill-upgrades')),
    revokeSkillUpgrade: (id: string, body: RevokeSkillUpgradeBody) =>
      call(() =>
        request<SkillUpgradeResponse>(`/skill-upgrades/${id}/revoke`, { method: 'POST', body }),
      ),
  };
}
