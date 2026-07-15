<script setup lang="ts">
import type { ApplicationStage } from '@careerforge/core';

import { ApiError } from '../../utils/api-error.ts';

// Application detail (M1-03): the stage control, the event trail, and the
// note/outcome form. Notes and event details are user-authored, not hostile —
// but the rendering law is free: {{ interpolation }} only, same as
// everywhere (vue/no-v-html is a lint error; inertness component-test
// pinned). Every mutation re-fetches the detail and renders SERVER truth
// (the M1-02 no-client-echo spirit): the trail shown is the trail stored,
// including the system-written stage_change events this page never writes
// itself — stage_change is unrepresentable in the events POST contract.
const api = useApi();
const route = useRoute();
const applicationId = String(route.params.id);

const STAGE_OPTIONS = [
  'considering',
  'applied',
  'screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const satisfies readonly ApplicationStage[];

// 404 → null: a missing application is an expected state, not an exception
// (posting-detail precedent).
const {
  data: application,
  status,
  error,
  refresh,
} = useAsyncData(`application-${applicationId}`, () =>
  api.getApplication(applicationId).catch((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }),
);

/** Browser-local today as YYYY-MM-DD for the date inputs — the server's
 *  fallback is UTC-today, so the form always sends the date explicitly. */
function localToday(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

// Stage control. The current stage is excluded from the options: same-stage
// PATCH is a 409 by design (every successful PATCH emits exactly one
// stage_change event), so the UI doesn't offer it.
const nextStage = ref<ApplicationStage | ''>('');
const stageDate = ref(localToday());
const stageError = ref<string | null>(null);
const transitioning = ref(false);
const stageChoices = computed(() =>
  STAGE_OPTIONS.filter((stage) => stage !== application.value?.stage),
);

async function updateStage() {
  if (!nextStage.value) return;
  stageError.value = null;
  transitioning.value = true;
  try {
    await api.updateApplicationStage(applicationId, {
      stage: nextStage.value,
      occurredOn: stageDate.value,
    });
    nextStage.value = '';
    await refresh();
  } catch (cause) {
    stageError.value =
      cause instanceof ApiError ? cause.message : 'Stage update failed. Is the API running?';
  } finally {
    transitioning.value = false;
  }
}

// Note/outcome form — the two USER-writable event kinds.
const eventKind = ref<'note' | 'outcome'>('note');
const eventDetail = ref('');
const eventDate = ref(localToday());
const eventError = ref<string | null>(null);
const addingEvent = ref(false);

async function addEvent() {
  eventError.value = null;
  addingEvent.value = true;
  try {
    await api.addApplicationEvent(applicationId, {
      kind: eventKind.value,
      detail: eventDetail.value,
      occurredOn: eventDate.value,
    });
    eventDetail.value = '';
    await refresh();
  } catch (cause) {
    eventError.value =
      cause instanceof ApiError ? cause.message : 'Could not add the event. Is the API running?';
  } finally {
    addingEvent.value = false;
  }
}

const notFound = computed(() => status.value === 'success' && application.value === null);

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
</script>

<template>
  <div>
    <p v-if="status === 'pending'">Loading application…</p>
    <p v-else-if="notFound" role="alert">
      Application not found. <NuxtLink to="/applications">Back to applications</NuxtLink>
    </p>
    <p v-else-if="error" role="alert">Could not load the application: {{ error.message }}</p>
    <template v-else-if="application">
      <div class="application-head">
        <div>
          <h1>{{ application.posting.title ?? 'Untitled posting' }}</h1>
          <p class="application-meta">
            {{ application.posting.company ?? 'Unknown company' }} ·
            <NuxtLink :to="`/postings/${application.postingId}`">View posting</NuxtLink>
          </p>
          <p class="application-meta">
            Stage: <strong data-testid="application-stage">{{ application.stage }}</strong>
            <template v-if="application.appliedOn"> · applied {{ application.appliedOn }}</template>
          </p>
        </div>
        <form class="stage-form" @submit.prevent="updateStage">
          <label>
            Move to
            <select v-model="nextStage" name="nextStage" required>
              <option value="" disabled>Choose a stage</option>
              <option v-for="stage in stageChoices" :key="stage" :value="stage">
                {{ stage }}
              </option>
            </select>
          </label>
          <label>
            On
            <input v-model="stageDate" name="stageDate" type="date" required />
          </label>
          <button type="submit" :disabled="transitioning || !nextStage">Update stage</button>
        </form>
      </div>
      <p v-if="stageError" role="alert">{{ stageError }}</p>

      <h2>History</h2>
      <ul class="event-trail" data-testid="event-trail">
        <li class="event-row">
          <span class="event-date">{{ shortDate(application.createdAt) }}</span>
          <span class="event-kind">tracked</span>
          <span>created from the posting</span>
        </li>
        <li v-for="event in application.events" :key="event.id" class="event-row">
          <span class="event-date">{{ event.occurredOn }}</span>
          <span class="event-kind">{{ event.kind === 'stage_change' ? 'stage' : event.kind }}</span>
          <span class="event-detail">{{ event.detail ?? '' }}</span>
        </li>
      </ul>

      <form class="event-form" @submit.prevent="addEvent">
        <h2>Add a note or outcome</h2>
        <label>
          Kind
          <select v-model="eventKind" name="eventKind">
            <option value="note">note</option>
            <option value="outcome">outcome</option>
          </select>
        </label>
        <label>
          Detail
          <textarea
            v-model="eventDetail"
            name="eventDetail"
            rows="3"
            required
            maxlength="5000"
          ></textarea>
        </label>
        <label>
          On
          <input v-model="eventDate" name="eventDate" type="date" required />
        </label>
        <p v-if="eventError" role="alert">{{ eventError }}</p>
        <button type="submit" :disabled="addingEvent">Add event</button>
      </form>
    </template>
  </div>
</template>

<style scoped>
.application-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
}
.application-meta {
  color: #555;
}
.stage-form {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}
.event-trail {
  list-style: none;
  padding: 0;
}
.event-row {
  display: flex;
  gap: 0.75rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid #eee;
}
.event-date {
  color: #555;
  min-width: 6.5rem;
}
.event-kind {
  color: #555;
  min-width: 5rem;
}
.event-detail {
  /* User-authored text: interpolated (inert by construction) with newlines
     preserved by CSS, never markup — the posting-raw pre-wrap precedent. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.event-form {
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 48rem;
}
</style>
