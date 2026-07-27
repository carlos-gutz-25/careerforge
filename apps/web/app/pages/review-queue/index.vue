<script setup lang="ts">
// Review queue (M3-05 UI, M8-13). The spaced-review projection: DUE revisits
// over the caller's completed exercises, recomputed from the server clock on
// every GET (nothing is stored, so nothing goes stale). Sorted soonest-due
// first by API contract. Exercise titles are user-authored and UNTRUSTED —
// rendered via {{ interpolation }} only (vue/no-v-html is a lint error). The
// one action is "Mark revisited": it records the EXISTING mastery-evidence
// with kind 'revisited' for that exercise, then re-fetches — the ladder
// recomputes and the item advances to its next interval (or graduates), so it
// leaves the due list. Dates and ids are evidence surfaces (mono).
import type { ReviewQueueItem } from '@careerforge/core';

const api = useApi();
const { data, status, error, refresh } = useAsyncData('review-queue', () => api.getReviewQueue());

const markingId = ref<string | null>(null);
const actionError = ref<string | null>(null);

async function markRevisited(item: ReviewQueueItem): Promise<void> {
  if (markingId.value) return;
  markingId.value = item.exerciseId;
  actionError.value = null;
  try {
    await api.createMasteryEvidence({ exerciseId: item.exerciseId, kind: 'revisited' });
    await refresh();
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Could not record the revisit.';
  } finally {
    markingId.value = null;
  }
}
</script>

<template>
  <div>
    <h1>Review queue</h1>
    <p class="rq-blurb">
      Completed exercises resurface here on a spaced schedule (7 / 30 / 90 days). Revisit each one
      to keep the skill fresh, then mark it reviewed — it returns at the next, longer interval until
      it graduates.
    </p>

    <p v-if="actionError" role="alert" class="rq-action-error" data-testid="rq-action-error">
      {{ actionError }}
    </p>

    <AppSkeleton v-if="status === 'pending'" :lines="4" />
    <p v-else-if="error" role="alert">Could not load the review queue: {{ error.message }}</p>
    <template v-else-if="data">
      <AppEmptyState v-if="data.items.length === 0">
        Nothing is due for review right now. Complete an exercise in a learning plan and it will
        resurface here when its first revisit comes due.
      </AppEmptyState>
      <ul v-else class="rq-list" data-testid="review-queue-list">
        <li
          v-for="item in data.items"
          :key="item.exerciseId"
          class="rq-item"
          data-testid="review-queue-row"
        >
          <div class="rq-main">
            <NuxtLink :to="`/learning-plans/${item.learningPlanId}`" class="rq-title">{{
              item.title
            }}</NuxtLink>
            <span class="rq-kind" data-testid="rq-kind">{{ item.kind }}</span>
          </div>
          <p class="rq-meta">
            <span class="rq-due" data-testid="rq-due"
              >due <time>{{ item.dueOn }}</time></span
            >
            <span class="rq-sub"
              >completed <time>{{ item.completedOn }}</time> · revisit {{ item.revisitCount + 1 }} ·
              {{ item.intervalDays }}-day interval</span
            >
          </p>
          <button
            type="button"
            class="rq-mark"
            data-testid="rq-mark-revisited"
            :disabled="markingId !== null"
            @click="markRevisited(item)"
          >
            {{ markingId === item.exerciseId ? 'Recording…' : 'Mark revisited' }}
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.rq-blurb {
  color: var(--color-muted);
  margin: 0 0 var(--space-4);
  max-width: 40rem;
}
.rq-action-error {
  color: var(--color-danger);
  margin: 0 0 var(--space-3);
}
.rq-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.rq-item {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.rq-main {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.rq-title {
  font-weight: 600;
}
.rq-kind {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.rq-meta {
  grid-column: 1 / 2;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.rq-due {
  color: var(--color-accent);
}
.rq-mark {
  grid-column: 2 / 3;
  grid-row: 1 / 3;
  align-self: center;
}
</style>
