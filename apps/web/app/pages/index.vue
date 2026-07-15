<script setup lang="ts">
// The profile view (M0-10 acceptance criterion): renders GET /profile — the
// packages/core wire shape, no client-side reshaping. Everything below is
// {{ interpolation }} only, never v-html (lint law vue/no-v-html): friendly
// data today, but M1-02 renders hostile posting text and the discipline
// starts here.
const api = useApi();
const { data: profile, status, error } = useAsyncData('profile', () => api.getProfile());

function period(start: string, end: string | null): string {
  return `${start} → ${end ?? 'present'}`;
}
</script>

<template>
  <div>
    <h1>Profile</h1>
    <p v-if="status === 'pending'">Loading profile…</p>
    <p v-else-if="error" role="alert">Could not load the profile: {{ error.message }}</p>
    <template v-else-if="profile">
      <section>
        <h2>Skills</h2>
        <p v-if="profile.skills.length === 0">
          No skills imported yet — run <code>pnpm profile:import</code>.
        </p>
        <table v-else>
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
              <td>{{ skill.category ?? '—' }}</td>
              <td>{{ skill.level }}</td>
              <td>{{ skill.years ?? '—' }}</td>
              <td>{{ skill.lastUsed ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Experience</h2>
        <ul>
          <li v-for="experience in profile.experiences" :key="experience.id">
            <strong>{{ experience.title }}</strong> · {{ experience.company }} ·
            {{ period(experience.startDate, experience.endDate) }}
          </li>
        </ul>
      </section>

      <section>
        <h2>Projects</h2>
        <ul>
          <li v-for="project in profile.projects" :key="project.id">
            <strong>{{ project.name }}</strong> ({{ project.provenance }})
            <p v-if="project.summary">{{ project.summary }}</p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
table {
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.25rem 0.75rem 0.25rem 0;
  border-bottom: 1px solid #eee;
}
</style>
