<script setup lang="ts">
// Command Center (M8-09) - the platform home. A dashboard composed ENTIRELY
// from existing list endpoints (no new API): the application pipeline, posting
// inventory, criteria tuning signal, and recent activity. Everything renders
// as {{ interpolation }} text - never v-html.
//
// V2-PLAN's Command Center also names "drafts awaiting review" and "due
// exercises". Both are DEFERRED here: drafts-awaiting-review has no aggregate
// endpoint (it would be one fit/plan/variant GET per posting - N calls with no
// batch surface), and the exercises API lands with M8-12. The criteria-tuning
// signal below is the review-worthy surface today's endpoints expose.
import type { ApplicationStage, JobPostingStatus } from '@careerforge/core';

const api = useApi();

const { data, status, error } = useAsyncData('command-center', async () => {
  const [postings, applications, criteria] = await Promise.all([
    api.listPostings(),
    api.listApplications(),
    api.getCriteriaSuggestions(),
  ]);
  return {
    postings: postings.postings,
    applications: applications.applications,
    criteria,
  };
});

// Active pipeline stages in flow order; closed stages are tallied separately so
// the pipeline reads as "in motion" without hiding outcomes.
const PIPELINE_STAGES: readonly ApplicationStage[] = [
  'considering',
  'applied',
  'screen',
  'interview',
  'offer',
];
const CLOSED_STAGES: readonly ApplicationStage[] = ['rejected', 'withdrawn'];
const STAGE_VARIANT: Record<
  ApplicationStage,
  'neutral' | 'draft' | 'reviewed' | 'danger' | 'info'
> = {
  considering: 'neutral',
  applied: 'draft',
  screen: 'info',
  interview: 'info',
  offer: 'reviewed',
  rejected: 'danger',
  withdrawn: 'danger',
};

const POSTING_STATUSES: readonly JobPostingStatus[] = ['new', 'extracted', 'scored', 'archived'];

function tally<T, K extends string>(items: T[], key: (item: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

const appsByStage = computed(() => tally(data.value?.applications ?? [], (a) => a.stage));
const postingsByStatus = computed(() => tally(data.value?.postings ?? [], (p) => p.status));
const activeCount = computed(() =>
  PIPELINE_STAGES.reduce((sum, stage) => sum + (appsByStage.value[stage] ?? 0), 0),
);

const suggestionCount = computed(() =>
  data.value?.criteria.status === 'ok' ? data.value.criteria.suggestions.length : 0,
);

interface ActivityItem {
  key: string;
  label: string;
  detail: string;
  date: string;
}
// Merge the two dated streams (postings pasted, applications tracked) into one
// recent list. appliedOn is a date-only string; createdAt is a datetime - both
// sort lexately in ISO form, so string compare is a correct recency order.
const recentActivity = computed<ActivityItem[]>(() => {
  if (!data.value) return [];
  const postingItems: ActivityItem[] = data.value.postings.map((p) => ({
    key: `posting-${p.id}`,
    label: 'Pasted posting',
    detail: [p.company, p.title].filter(Boolean).join(' - ') || 'Untitled posting',
    date: p.createdAt,
  }));
  const appItems: ActivityItem[] = data.value.applications.map((a) => ({
    key: `application-${a.id}`,
    label: 'Tracked application',
    detail: [a.posting.company, a.posting.title].filter(Boolean).join(' - ') || 'Untitled posting',
    date: a.appliedOn ?? a.createdAt,
  }));
  return [...postingItems, ...appItems].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 6);
});
</script>

<template>
  <div>
    <h1>Command Center</h1>
    <p class="cc-intro">Your search at a glance - pipeline, postings, and what needs attention.</p>

    <nav class="cc-actions" aria-label="Quick actions">
      <NuxtLink class="cc-action" to="/postings/new">Paste a posting</NuxtLink>
      <NuxtLink class="cc-action" to="/applications">Track applications</NuxtLink>
      <NuxtLink class="cc-action" to="/criteria">Tune criteria</NuxtLink>
    </nav>

    <AppSkeleton v-if="status === 'pending'" :lines="8" />
    <p v-else-if="error" role="alert">Could not load the command center: {{ error.message }}</p>

    <div v-else-if="data" class="cc-grid">
      <AppPanel class="cc-card">
        <h2>Pipeline</h2>
        <AppEmptyState v-if="activeCount === 0">
          No active applications.
          <template #action>
            <NuxtLink to="/postings">Find a posting to track</NuxtLink>
          </template>
        </AppEmptyState>
        <template v-else>
          <ul class="cc-chiprow">
            <template v-for="stage in PIPELINE_STAGES" :key="stage">
              <li v-if="appsByStage[stage]">
                <AppStateChip :variant="STAGE_VARIANT[stage]">
                  {{ stage }} {{ appsByStage[stage] }}
                </AppStateChip>
              </li>
            </template>
          </ul>
          <p v-if="CLOSED_STAGES.some((s) => appsByStage[s])" class="cc-closed">
            <template v-for="stage in CLOSED_STAGES" :key="stage">
              <span v-if="appsByStage[stage]">{{ stage }} {{ appsByStage[stage] }} </span>
            </template>
          </p>
          <NuxtLink class="cc-link" to="/applications">View all applications</NuxtLink>
        </template>
      </AppPanel>

      <AppPanel class="cc-card">
        <h2>Postings</h2>
        <AppEmptyState v-if="data.postings.length === 0">
          No postings yet.
          <template #action>
            <NuxtLink to="/postings/new">Paste your first posting</NuxtLink>
          </template>
        </AppEmptyState>
        <template v-else>
          <ul class="cc-chiprow">
            <template v-for="status_ in POSTING_STATUSES" :key="status_">
              <li v-if="postingsByStatus[status_]">
                <AppStateChip variant="neutral">
                  {{ status_ }} {{ postingsByStatus[status_] }}
                </AppStateChip>
              </li>
            </template>
          </ul>
          <NuxtLink class="cc-link" to="/postings">View all postings</NuxtLink>
        </template>
      </AppPanel>

      <AppPanel class="cc-card">
        <h2>Needs attention</h2>
        <AppEmptyState v-if="suggestionCount === 0"> Nothing waiting on you. </AppEmptyState>
        <template v-else>
          <p>
            <AppStateChip variant="info">{{ suggestionCount }}</AppStateChip>
            criteria tuning {{ suggestionCount === 1 ? 'suggestion' : 'suggestions' }} from your
            outcomes.
          </p>
          <NuxtLink class="cc-link" to="/criteria">Review suggestions</NuxtLink>
        </template>
      </AppPanel>

      <AppPanel class="cc-card">
        <h2>Recent activity</h2>
        <AppEmptyState v-if="recentActivity.length === 0"> No activity yet. </AppEmptyState>
        <ul v-else class="cc-activity">
          <li v-for="item in recentActivity" :key="item.key">
            <span class="cc-activity-label">{{ item.label }}</span>
            <span class="cc-activity-detail">{{ item.detail }}</span>
          </li>
        </ul>
      </AppPanel>
    </div>
  </div>
</template>

<style scoped>
.cc-intro {
  color: var(--color-muted);
  margin-bottom: var(--space-5);
}
.cc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}
.cc-action {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-link);
  text-decoration: none;
  transition: background-color var(--transition-fast);
}
.cc-action:hover {
  background: var(--color-panel);
}
.cc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--space-4);
}
.cc-card h2 {
  font-size: var(--font-size-lg);
  margin-bottom: var(--space-3);
}
.cc-chiprow {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-3) 0;
}
.cc-closed {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
  margin-bottom: var(--space-3);
}
.cc-link {
  color: var(--color-link);
}
.cc-activity {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  list-style: none;
  padding: 0;
  margin: 0;
}
.cc-activity li {
  display: flex;
  flex-direction: column;
}
.cc-activity-label {
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
</style>
