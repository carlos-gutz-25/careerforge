<script setup lang="ts">
import type { ApplicationStage } from '@careerforge/core';

// Application list (M1-03): metadata only — rows carry a company/title
// posting summary, never rawText (API contract). Rendered via
// {{ interpolation }} only (vue/no-v-html is a lint error). The stage filter
// is the AC's "list view filterable by stage": filtering happens in SQL via
// ?stage=, not client-side.
const api = useApi();

// UI enumeration of the stage enum, typed against core so an invalid value
// fails typecheck (web hardcodes user-facing enum literals — the M1-02
// archive/unarchive precedent; core value imports would pull zod into the
// bundle).
const STAGE_OPTIONS = [
  'considering',
  'applied',
  'screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const satisfies readonly ApplicationStage[];

const stageFilter = ref<ApplicationStage | ''>('');

// Stage-inclusive key: each filter value caches separately, so switching
// filters never renders one stage's rows under another's label (the M1-02
// useAsyncData cross-mount caching finding, applied at design time).
const { data, status, error } = useAsyncData(
  () => `applications-${stageFilter.value || 'all'}`,
  () => api.listApplications(stageFilter.value ? { stage: stageFilter.value } : undefined),
  { watch: [stageFilter] },
);

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
</script>

<template>
  <div>
    <div class="applications-head">
      <h1>Applications</h1>
      <label class="applications-filter">
        Stage
        <select v-model="stageFilter" name="stage">
          <option value="">All stages</option>
          <option v-for="stage in STAGE_OPTIONS" :key="stage" :value="stage">{{ stage }}</option>
        </select>
      </label>
    </div>
    <p v-if="status === 'pending'">Loading applications…</p>
    <p v-else-if="error" role="alert">Could not load applications: {{ error.message }}</p>
    <template v-else-if="data">
      <p v-if="data.applications.length === 0 && stageFilter">
        No applications in stage “{{ stageFilter }}”.
      </p>
      <p v-else-if="data.applications.length === 0">
        No applications yet — track one from a
        <NuxtLink to="/postings">posting's detail page</NuxtLink>.
      </p>
      <table v-else>
        <thead>
          <tr>
            <th>Company</th>
            <th>Title</th>
            <th>Stage</th>
            <th>Applied</th>
            <th>Tracked</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="application in data.applications" :key="application.id">
            <td>{{ application.posting.company ?? '—' }}</td>
            <td>
              <NuxtLink :to="`/applications/${application.id}`">
                {{ application.posting.title ?? 'Untitled' }}
              </NuxtLink>
            </td>
            <td>{{ application.stage }}</td>
            <td>{{ application.appliedOn ?? '—' }}</td>
            <td>{{ shortDate(application.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.applications-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.applications-filter {
  color: #555;
}
.applications-filter select {
  margin-left: 0.5rem;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: 0.25rem 0.75rem 0.25rem 0;
  border-bottom: 1px solid #eee;
}
</style>
