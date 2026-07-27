<script setup lang="ts">
// Evidence Library (M8-09). The profile view relocated from `/` and reframed:
// skills / experience / projects are the EVIDENCE BASE that deterministic fit
// scoring cites (PLAN.md - "every fit score and gap classification cites
// verbatim evidence from both the posting and the profile"). Renders GET
// /profile, the packages/core wire shape, with {{ interpolation }} only - never
// v-html (lint law vue/no-v-html): this data is friendly today but the
// discipline is uniform across the app.
const api = useApi();
const { data: profile, status, error } = useAsyncData('profile', () => api.getProfile());

function period(start: string, end: string | null): string {
  return `${start} to ${end ?? 'present'}`;
}
</script>

<template>
  <div>
    <h1>Evidence Library</h1>
    <p class="evidence-intro">
      The skills, experience, and projects fit scoring draws on. Every sub-score and gap cites
      verbatim evidence from this library and the posting.
    </p>

    <AppSkeleton v-if="status === 'pending'" :lines="6" />
    <p v-else-if="error" role="alert">Could not load the evidence library: {{ error.message }}</p>
    <template v-else-if="profile">
      <AppPanel class="evidence-section">
        <h2>Skills</h2>
        <AppEmptyState v-if="profile.skills.length === 0">
          No skills imported yet - run <code>pnpm profile:import</code>.
        </AppEmptyState>
        <table v-else class="evidence-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Category</th>
              <th>Level</th>
              <th>Years</th>
              <th>Last used</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="skill in profile.skills" :key="skill.id">
              <td>{{ skill.name }}</td>
              <td>{{ skill.category ?? '-' }}</td>
              <td>{{ skill.level }}</td>
              <td>{{ skill.years ?? '-' }}</td>
              <td>{{ skill.lastUsed ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
      </AppPanel>

      <AppPanel class="evidence-section">
        <h2>Experience</h2>
        <AppEmptyState v-if="profile.experiences.length === 0">
          No experience imported yet.
        </AppEmptyState>
        <ul v-else class="evidence-list">
          <li v-for="experience in profile.experiences" :key="experience.id">
            <strong>{{ experience.title }}</strong> at {{ experience.company }}
            <span class="evidence-period">{{
              period(experience.startDate, experience.endDate)
            }}</span>
          </li>
        </ul>
      </AppPanel>

      <AppPanel class="evidence-section">
        <h2>Projects</h2>
        <AppEmptyState v-if="profile.projects.length === 0">
          No projects imported yet.
        </AppEmptyState>
        <ul v-else class="evidence-list">
          <li v-for="project in profile.projects" :key="project.id">
            <strong>{{ project.name }}</strong>
            <AppStateChip variant="neutral">{{ project.provenance }}</AppStateChip>
            <p v-if="project.summary" class="evidence-summary">{{ project.summary }}</p>
          </li>
        </ul>
      </AppPanel>
    </template>
  </div>
</template>

<style scoped>
.evidence-intro {
  color: var(--color-muted);
  max-width: 44rem;
  margin-bottom: var(--space-6);
}
.evidence-section {
  margin-bottom: var(--space-4);
}
.evidence-section h2 {
  font-size: var(--font-size-lg);
  margin-bottom: var(--space-3);
}
.evidence-table {
  border-collapse: collapse;
  width: 100%;
}
.evidence-table th,
.evidence-table td {
  text-align: left;
  padding: var(--space-1) var(--space-4) var(--space-1) 0;
  border-bottom: 1px solid var(--color-border);
}
.evidence-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  list-style: none;
  padding: 0;
  margin: 0;
}
.evidence-period {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.evidence-summary {
  color: var(--color-muted);
  margin-top: var(--space-1);
}
</style>
