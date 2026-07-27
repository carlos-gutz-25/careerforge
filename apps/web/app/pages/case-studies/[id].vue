<script setup lang="ts">
import type { ExerciseCaseStudyProvenance } from '@careerforge/core';
import { ApiError } from '../../utils/api-error.ts';

// Case-study draft detail (M4-01 UI, M8-14). One draft with its rendered
// markdown and the manage actions. RENDERING LAW (M1-02, the postings-raw
// <pre> precedent): renderedMarkdown is user/template-derived and UNTRUSTED —
// rendered as ESCAPED TEXT inside a <pre> (mono, pre-wrap), NEVER parsed as
// HTML/markdown (vue/no-v-html is a lint error). title / exerciseTitle are
// {{ interpolation }}-only untrusted too.
//
// Actions: Refresh re-renders the draft from the exercise's latest evidence
// (re-POST, draft only — 409 once published; only when the source exercise
// still exists AND the stored provenance is a wire-creatable value, keeping the
// current title). Publish is the one-way CAS flip draft→published (locks
// refresh). Export downloads the raw markdown. Delete removes the draft (the
// mis-publish recourse) and returns to the list.
const api = useApi();
const route = useRoute();
const studyId = String(route.params.id);

// A missing/foreign draft is a 404 -> null (an expected state, not an
// exception) — the learning-plan-detail / posting-detail precedent.
const { data, status, error, refresh } = useAsyncData(`case-study-${studyId}`, () =>
  api.getCaseStudy(studyId).catch((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }),
);

const study = computed(() => data.value ?? null);
const notFound = computed(() => status.value === 'success' && data.value === null);

function studyDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

// The POST /case-studies body only accepts the personal provenance subset; a
// draft whose stored provenance is `professional` (or whose source exercise was
// deleted, exerciseId null) cannot be refreshed through the wire, so Refresh is
// hidden for it. The narrowed value feeds the re-POST.
const wireProvenance = computed<ExerciseCaseStudyProvenance | null>(() => {
  const p = study.value?.provenance;
  return p === 'personal' || p === 'personal_ai_assisted' ? p : null;
});
const canRefresh = computed(
  () =>
    study.value?.status === 'draft' &&
    study.value.exerciseId !== null &&
    wireProvenance.value !== null,
);

const actionError = ref<string | null>(null);
const busy = ref<'refresh' | 'publish' | 'export' | 'delete' | null>(null);

async function refreshDraft(): Promise<void> {
  if (!study.value || !canRefresh.value || busy.value) return;
  const provenance = wireProvenance.value;
  const exerciseId = study.value.exerciseId;
  if (!provenance || !exerciseId) return;
  actionError.value = null;
  busy.value = 'refresh';
  try {
    // Keep the current title (full-replacement semantics reset an OMITTED title
    // to the exercise title; sending it preserves what's shown, OD-1).
    await api.createCaseStudy({ exerciseId, provenance, title: study.value.title });
    await refresh();
  } catch (cause) {
    actionError.value =
      cause instanceof ApiError
        ? cause.message
        : 'Could not refresh the draft. Is the API running?';
  } finally {
    busy.value = null;
  }
}

async function publishDraft(): Promise<void> {
  if (!study.value || study.value.status !== 'draft' || busy.value) return;
  actionError.value = null;
  busy.value = 'publish';
  try {
    await api.publishCaseStudy(study.value.id);
    await refresh();
  } catch (cause) {
    actionError.value =
      cause instanceof ApiError
        ? cause.message
        : 'Could not publish the draft. Is the API running?';
  } finally {
    busy.value = null;
  }
}

async function exportDraft(): Promise<void> {
  if (!study.value || busy.value) return;
  actionError.value = null;
  busy.value = 'export';
  try {
    await api.exportCaseStudy(study.value.id);
  } catch (cause) {
    actionError.value =
      cause instanceof ApiError ? cause.message : 'Could not export the draft. Is the API running?';
  } finally {
    busy.value = null;
  }
}

async function deleteDraft(): Promise<void> {
  if (!study.value || busy.value) return;
  actionError.value = null;
  busy.value = 'delete';
  try {
    await api.deleteCaseStudy(study.value.id);
    await navigateTo('/case-studies');
  } catch (cause) {
    actionError.value =
      cause instanceof ApiError ? cause.message : 'Could not delete the draft. Is the API running?';
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <p v-if="status === 'pending'">Loading case study…</p>
    <p v-else-if="notFound" role="alert">
      Case study not found. <NuxtLink to="/case-studies">Back to case studies</NuxtLink>
    </p>
    <p v-else-if="error" role="alert">Could not load the case study: {{ error.message }}</p>
    <template v-else-if="study">
      <p class="cs-back"><NuxtLink to="/case-studies">← All case studies</NuxtLink></p>
      <div class="cs-head">
        <h1>{{ study.title }}</h1>
        <AppStateChip
          :variant="study.status === 'published' ? 'reviewed' : 'draft'"
          data-testid="cs-status-chip"
        >
          {{ study.status }}
        </AppStateChip>
      </div>
      <p class="cs-meta" data-testid="cs-meta">
        <span class="cs-provenance" data-testid="cs-provenance">{{ study.provenance }}</span>
        <span class="cs-source">from exercise: {{ study.exerciseTitle }}</span>
        <span class="cs-dates"
          >updated <time>{{ studyDateTime(study.updatedAt) }}</time></span
        >
      </p>

      <p v-if="actionError" role="alert" class="cs-action-error" data-testid="cs-action-error">
        {{ actionError }}
      </p>

      <div class="cs-actions" data-testid="cs-actions">
        <button
          v-if="canRefresh"
          type="button"
          :disabled="busy !== null"
          data-testid="cs-refresh"
          @click="refreshDraft"
        >
          {{ busy === 'refresh' ? 'Refreshing…' : 'Refresh from evidence' }}
        </button>
        <button
          v-if="study.status === 'draft'"
          type="button"
          class="cs-publish"
          :disabled="busy !== null"
          data-testid="cs-publish"
          @click="publishDraft"
        >
          {{ busy === 'publish' ? 'Publishing…' : 'Publish' }}
        </button>
        <button
          type="button"
          :disabled="busy !== null"
          data-testid="cs-export"
          @click="exportDraft"
        >
          {{ busy === 'export' ? 'Exporting…' : 'Export markdown' }}
        </button>
        <button
          type="button"
          class="cs-delete"
          :disabled="busy !== null"
          data-testid="cs-delete"
          @click="deleteDraft"
        >
          {{ busy === 'delete' ? 'Deleting…' : 'Delete' }}
        </button>
      </div>

      <!-- RENDERING LAW: renderedMarkdown is UNTRUSTED — escaped {{ }} text in a
           <pre>, NEVER parsed as markup (v-html is banned). The mono pre-wrap
           surface is the postings-raw precedent. -->
      <pre class="cs-markdown" data-testid="cs-markdown">{{ study.renderedMarkdown }}</pre>
    </template>
  </div>
</template>

<style scoped>
.cs-back {
  margin: 0 0 var(--space-2);
}
.cs-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.cs-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: var(--space-1) 0 var(--space-3);
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.cs-provenance {
  font-family: var(--font-mono);
}
.cs-action-error {
  color: var(--color-danger);
  margin: 0 0 var(--space-3);
}
.cs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.cs-publish {
  color: var(--color-reviewed);
}
.cs-delete {
  color: var(--color-danger);
}
.cs-markdown {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin: 0;
  color: var(--color-text);
}
</style>
