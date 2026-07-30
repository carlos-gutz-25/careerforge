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
// M12-03: declared durable facts (work authorization, sponsorship, stances, ...).
// Read-only here; facts.md is the source of truth (D-4). Rendered with
// {{ interpolation }} only (no v-html) like the rest of this page.
const { data: facts, error: factsError } = useAsyncData('profile-facts', () =>
  api.getProfileFacts(),
);

function period(start: string, end: string | null): string {
  return `${start} to ${end ?? 'present'}`;
}

const FACT_KIND_LABELS: Record<string, string> = {
  work_authorization: 'Work authorization',
  visa_sponsorship_needed: 'Visa sponsorship needed',
  relocation_stance: 'Relocation',
  remote_onsite_stance: 'Remote / onsite',
  security_clearance: 'Security clearance',
  availability_notice: 'Availability',
};
function factLabel(kind: string): string {
  return FACT_KIND_LABELS[kind] ?? kind;
}
// Closed-vocabulary values are snake_case; render them readably without
// inventing meaning (free-form values pass through unchanged).
function humanizeValue(value: string): string {
  return value.replace(/_/g, ' ');
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

      <AppPanel class="evidence-section">
        <h2>Declared facts</h2>
        <p v-if="factsError" role="alert">
          Could not load declared facts: {{ factsError.message }}
        </p>
        <AppEmptyState v-else-if="!facts || facts.facts.length === 0">
          No durable facts declared. Add <code>docs/profile/facts.md</code> and run
          <code>pnpm profile:import</code>.
        </AppEmptyState>
        <template v-else>
          <ul class="evidence-list">
            <li v-for="fact in facts.facts" :key="fact.kind">
              <strong>{{ factLabel(fact.kind) }}</strong
              >: {{ humanizeValue(fact.value) }}
              <span class="evidence-period">declared {{ fact.declaredAt }}</span>
              <p v-if="fact.note" class="evidence-summary">{{ fact.note }}</p>
            </li>
          </ul>
          <p class="evidence-summary">
            Facts come from <code>docs/profile/facts.md</code> - edit it and re-run
            <code>pnpm profile:import</code> to update. They inform requirement checks; they are
            never used to filter a posting out.
          </p>
        </template>
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
