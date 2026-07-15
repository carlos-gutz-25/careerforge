<script setup lang="ts">
// Posting list (M1-02): metadata ONLY — the API's list payload carries no
// rawText by contract, and this page renders via {{ interpolation }} only
// (vue/no-v-html is a lint error). Posting text is rendered exactly once,
// escaped, on the detail page.
const api = useApi();
const { data, status, error } = useAsyncData('postings', () => api.listPostings());

function ingestDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
</script>

<template>
  <div>
    <div class="postings-head">
      <h1>Postings</h1>
      <NuxtLink to="/postings/new">Paste a posting</NuxtLink>
    </div>
    <p v-if="status === 'pending'">Loading postings…</p>
    <p v-else-if="error" role="alert">Could not load postings: {{ error.message }}</p>
    <template v-else-if="data">
      <p v-if="data.postings.length === 0">
        No postings yet — <NuxtLink to="/postings/new">paste the first one</NuxtLink>.
      </p>
      <table v-else>
        <thead>
          <tr>
            <th>Company</th>
            <th>Title</th>
            <th>Status</th>
            <th>Ingested</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="posting in data.postings"
            :key="posting.id"
            :class="{ 'posting-archived': posting.status === 'archived' }"
          >
            <td>{{ posting.company ?? '—' }}</td>
            <td>
              <NuxtLink :to="`/postings/${posting.id}`">{{ posting.title ?? 'Untitled' }}</NuxtLink>
            </td>
            <td>{{ posting.status }}</td>
            <td>{{ ingestDate(posting.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.postings-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
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
.posting-archived {
  color: #888;
}
.posting-archived a {
  color: #888;
}
</style>
