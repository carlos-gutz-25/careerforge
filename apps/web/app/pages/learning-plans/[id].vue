<script setup lang="ts">
import { ApiError } from '../../utils/api-error.ts';

// Learning plan detail (M3-01 UI, M8-12). One plan with its cited gaps, the
// user's exercises for it (read-only here — create/edit land in later M8-12
// slices), and each exercise's mastery evidence count. Rendering law (M1-02):
// title / focus / gap fields / exercise titles are LLM/posting-derived and
// UNTRUSTED — {{ interpolation }} only (vue/no-v-html is a lint error). Review
// is the one-shot draft→reviewed action (the plan-section precedent).
const api = useApi();
const route = useRoute();
const planId = String(route.params.id);

// A missing/foreign plan is a 404 -> null (an expected state, not an
// exception) — the posting-detail precedent.
const { data, status, error, refresh } = useAsyncData(`learning-plan-${planId}`, () =>
  api.getLearningPlan(planId).catch((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }),
);

const plan = computed(() => data.value?.plan ?? null);
const run = computed(() => data.value?.run ?? null);
const notFound = computed(() => status.value === 'success' && data.value === null);

// One-shot review (the plan/resume/interview-section pattern).
const reviewNotes = ref('');
const reviewing = ref(false);
const reviewError = ref<string | null>(null);
async function markReviewed() {
  if (!plan.value || reviewing.value) return;
  reviewError.value = null;
  reviewing.value = true;
  try {
    await api.reviewLearningPlan(plan.value.id, {
      notes: reviewNotes.value ? reviewNotes.value : null,
    });
    await refresh();
  } catch (cause) {
    reviewError.value =
      cause instanceof ApiError ? cause.message : 'Review failed. Is the API running?';
  } finally {
    reviewing.value = false;
  }
}
</script>

<template>
  <div>
    <p v-if="status === 'pending'">Loading learning plan…</p>
    <p v-else-if="notFound" role="alert">
      Learning plan not found. <NuxtLink to="/learning-plans">Back to learning plans</NuxtLink>
    </p>
    <p v-else-if="error" role="alert">Could not load the plan: {{ error.message }}</p>
    <template v-else-if="plan">
      <p class="lp-back"><NuxtLink to="/learning-plans">← All learning plans</NuxtLink></p>
      <div class="lp-head">
        <h1>{{ plan.title }}</h1>
        <AppStateChip
          :variant="plan.reviewStatus === 'reviewed' ? 'reviewed' : 'draft'"
          data-testid="lp-review-chip"
        >
          {{ plan.reviewStatus }}
        </AppStateChip>
      </div>
      <pre v-if="plan.notes" class="lp-notes" data-testid="lp-notes">{{ plan.notes }}</pre>

      <h2>Cited gaps</h2>
      <ol class="lp-gaps" data-testid="lp-gaps">
        <li v-for="gap in plan.gaps" :key="gap.id" data-testid="lp-gap">
          <p class="lp-focus">{{ gap.focus }}</p>
          <p class="lp-gap-meta">
            on: {{ gap.requirementText }}
            <span class="lp-chip">{{ gap.gapClassification }}</span>
            <span class="lp-chip">priority {{ gap.priority }}</span>
            <span class="lp-chip">{{ gap.requirementCategory }}</span>
          </p>
        </li>
      </ol>

      <h2>Exercises</h2>
      <AppEmptyState v-if="plan.exercises.length === 0" data-testid="lp-no-exercises">
        No exercises yet for this plan.
      </AppEmptyState>
      <ul v-else class="lp-exercises" data-testid="lp-exercises">
        <li v-for="exercise in plan.exercises" :key="exercise.id" data-testid="lp-exercise">
          <p class="lp-exercise-title">
            {{ exercise.title }}
            <span class="lp-chip">{{ exercise.kind }}</span>
            <span class="lp-chip" data-testid="lp-exercise-status">{{ exercise.status }}</span>
          </p>
          <p class="lp-exercise-meta">
            addresses {{ exercise.gapIds.length }} gap{{
              exercise.gapIds.length === 1 ? '' : 's'
            }}
            · {{ exercise.evidence.length }} evidence
          </p>
        </li>
      </ul>

      <div v-if="plan.reviewStatus === 'draft'" class="lp-review" data-testid="lp-review-form">
        <textarea
          v-model="reviewNotes"
          :disabled="reviewing"
          placeholder="Review notes (optional)"
          data-testid="lp-review-notes"
        ></textarea>
        <button
          type="button"
          :disabled="reviewing"
          data-testid="lp-mark-reviewed"
          @click="markReviewed"
        >
          {{ reviewing ? 'Saving…' : 'Mark reviewed' }}
        </button>
        <p v-if="reviewError" role="alert" data-testid="lp-review-error">{{ reviewError }}</p>
      </div>

      <details v-if="run" class="lp-run-evidence" data-testid="lp-run-evidence">
        <summary class="lp-run-summary">Run evidence</summary>
        <p class="lp-telemetry" data-testid="lp-telemetry">
          {{ run.model }} · {{ run.promptId }} · {{ run.inputTokens }}/{{ run.outputTokens }} tok ·
          {{ run.latencyMs }} ms · {{ run.status }} · attempt {{ run.attempt }}
        </p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.lp-back {
  margin: 0 0 var(--space-2);
}
.lp-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.lp-notes {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  background: var(--color-panel);
  border-left: 3px solid var(--color-border);
  padding: 0.35rem 0.6rem;
  margin: var(--space-2) 0 var(--space-4);
  color: var(--color-text);
}
.lp-gaps,
.lp-exercises {
  padding-left: var(--space-4);
}
.lp-gaps > li,
.lp-exercises > li {
  margin-bottom: var(--space-3);
}
.lp-focus,
.lp-exercise-title {
  margin: 0 0 0.15rem;
  font-weight: 600;
}
.lp-gap-meta,
.lp-exercise-meta {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.lp-chip {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.lp-exercises {
  list-style: none;
  padding-left: 0;
}
.lp-review textarea {
  display: block;
  width: 100%;
  max-width: 32rem;
  min-height: 4rem;
  margin-bottom: var(--space-2);
}
.lp-run-evidence {
  margin-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-2);
}
.lp-run-summary {
  color: var(--color-muted);
  cursor: pointer;
}
.lp-telemetry {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
</style>
