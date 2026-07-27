<script setup lang="ts">
// Case-study drafts list (M4-01 UI, M8-14). Each row is a portfolio-bound
// draft generated deterministically from a completed exercise; the list is a
// picker (renderedMarkdown omitted by API contract), in (created_at, id) order.
// Titles are user/template-derived and UNTRUSTED — rendered via {{ }} only
// (vue/no-v-html is a lint error). Drafting happens from a completed exercise
// on its learning plan (M8-14 slice 2); this view surfaces the drafts that
// exist, links into each, and shows its draft/published status + provenance.
const api = useApi();
const { data, status, error } = useAsyncData('case-studies', () => api.listCaseStudies());

function studyDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
</script>

<template>
  <div>
    <h1>Case studies</h1>
    <p class="cs-blurb">
      Portfolio case-study drafts, each generated from a completed exercise and its evidence. Refine
      a draft, export it, then publish it into your portfolio.
    </p>

    <AppSkeleton v-if="status === 'pending'" :lines="4" />
    <p v-else-if="error" role="alert">Could not load case studies: {{ error.message }}</p>
    <template v-else-if="data">
      <AppEmptyState v-if="data.caseStudies.length === 0">
        No case-study drafts yet — draft one from a completed exercise on its learning plan.
      </AppEmptyState>
      <ul v-else class="cs-list" data-testid="case-studies-list">
        <li
          v-for="study in data.caseStudies"
          :key="study.id"
          class="cs-item"
          data-testid="case-study-row"
        >
          <NuxtLink :to="`/case-studies/${study.id}`" class="cs-title">{{ study.title }}</NuxtLink>
          <span class="cs-meta">
            <AppStateChip
              :variant="study.status === 'published' ? 'reviewed' : 'draft'"
              data-testid="cs-status-chip"
            >
              {{ study.status }}
            </AppStateChip>
            <span class="cs-provenance" data-testid="cs-provenance">{{ study.provenance }}</span>
            <span class="cs-date">{{ studyDate(study.updatedAt) }}</span>
          </span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.cs-blurb {
  color: var(--color-muted);
  margin: 0 0 var(--space-4);
  max-width: 40rem;
}
.cs-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.cs-item {
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
.cs-title {
  font-weight: 600;
}
.cs-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.cs-provenance {
  font-family: var(--font-mono);
}
</style>
