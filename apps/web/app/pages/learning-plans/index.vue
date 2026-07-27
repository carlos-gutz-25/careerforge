<script setup lang="ts">
// Learning plans list (M3-01 UI, M8-12). Meta-only summaries (the list
// carries no gap joins by API contract), newest first, plural by design
// (ADR-0013 free-create). Titles are LLM-derived and UNTRUSTED — rendered via
// {{ interpolation }} only (vue/no-v-html is a lint error). Drill into one via
// its detail link. Plans are drafted from a posting's classified gaps (that
// create affordance lands in a later M8-12 slice); this view surfaces and
// reviews the plans that exist.
const api = useApi();
const { data, status, error } = useAsyncData('learning-plans', () => api.listLearningPlans());

function planDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
</script>

<template>
  <div>
    <h1>Learning plans</h1>
    <p class="lp-blurb">
      Skill-growth plans drafted from a posting's classified gaps — each a set of learning foci you
      can turn into exercises and prove with evidence.
    </p>

    <AppSkeleton v-if="status === 'pending'" :lines="4" />
    <p v-else-if="error" role="alert">Could not load learning plans: {{ error.message }}</p>
    <template v-else-if="data">
      <AppEmptyState v-if="data.plans.length === 0">
        No learning plans yet — draft one from a posting's gaps in the Gaps stage of a fit report.
      </AppEmptyState>
      <ul v-else class="lp-list" data-testid="learning-plans-list">
        <li
          v-for="plan in data.plans"
          :key="plan.id"
          class="lp-item"
          data-testid="learning-plan-row"
        >
          <NuxtLink :to="`/learning-plans/${plan.id}`" class="lp-title">{{ plan.title }}</NuxtLink>
          <span class="lp-meta">
            <AppStateChip :variant="plan.reviewStatus === 'reviewed' ? 'reviewed' : 'draft'">
              {{ plan.reviewStatus }}
            </AppStateChip>
            <span class="lp-count"
              >{{ plan.gapCount }} gap{{ plan.gapCount === 1 ? '' : 's' }}</span
            >
            <span class="lp-date">{{ planDate(plan.createdAt) }}</span>
          </span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.lp-blurb {
  color: var(--color-muted);
  margin: 0 0 var(--space-4);
}
.lp-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.lp-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-3);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.lp-title {
  font-weight: 600;
}
.lp-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
</style>
