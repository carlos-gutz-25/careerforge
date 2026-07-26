<script setup lang="ts">
import type { CriteriaAdjustmentSuggestion } from '@careerforge/core';

// Criteria tuning (M4-02): application outcomes SUGGEST removing a search-signal
// slug; the change is applied only on explicit confirmation (human in the loop).
// Everything is deterministic and observation-voice - the copy describes N
// outcomes, never asserts a cause. All text renders via {{ interpolation }} only
// (vue/no-v-html is a lint error); company/title are user-curated posting
// metadata and stay escaped. The confirm pins the criteria compare-and-swap to
// the criteriaUpdatedAt this view was built from - a stale pin is a 409, which
// this page turns into a refresh, never a blind retry.
const api = useApi();

const {
  data: suggestions,
  status,
  error,
  refresh: refreshSuggestions,
} = useAsyncData('criteria-suggestions', () => api.getCriteriaSuggestions());
const { data: audit, refresh: refreshAudit } = useAsyncData('criteria-adjustments', () =>
  api.listCriteriaAdjustments(),
);

const applyingSlug = ref<string | null>(null);
const notice = ref<string | null>(null);

function headline(suggestion: CriteriaAdjustmentSuggestion): string {
  return suggestion.kind === 'remove_positive_signal'
    ? `Consider removing "${suggestion.slug}" from your ${suggestion.category ?? ''} signals.`
    : `Consider removing "${suggestion.slug}" from your avoid list.`;
}

function observation(suggestion: CriteriaAdjustmentSuggestion): string {
  const { matched, unmatched } = suggestion.evidence;
  return (
    `Of the ${matched.total} resolved applications whose postings mentioned "${suggestion.slug}", ` +
    `${matched.progressed} reached a screen; ${unmatched.progressed} of ${unmatched.total} others did. ` +
    `This describes ${matched.total} outcomes, not a cause.`
  );
}

async function apply(suggestion: CriteriaAdjustmentSuggestion): Promise<void> {
  const pin = suggestions.value?.criteriaUpdatedAt;
  if (!pin) return;
  applyingSlug.value = suggestion.slug;
  notice.value = null;
  try {
    await api.confirmCriteriaAdjustment({
      kind: suggestion.kind,
      category: suggestion.category,
      slug: suggestion.slug,
      expectedUpdatedAt: pin,
    });
    notice.value = `Removed "${suggestion.slug}" from your criteria.`;
  } catch {
    // Any 409 (the suggestion is no longer derivable, or the pin went stale):
    // the underlying state changed - re-fetch and tell the user, never retry
    // blindly against a moved target.
    notice.value = 'The data changed since these suggestions were shown - refreshed.';
  } finally {
    applyingSlug.value = null;
    await Promise.all([refreshSuggestions(), refreshAudit()]);
  }
}
</script>

<template>
  <div>
    <div class="criteria-head">
      <h1>Criteria tuning</h1>
      <NuxtLink to="/applications">Back to applications</NuxtLink>
    </div>
    <p class="criteria-lede">
      Suggestions from your application outcomes. Each describes what happened - you decide whether
      to change your search criteria.
    </p>

    <p v-if="status === 'pending'">Loading suggestions…</p>
    <p v-else-if="error" role="alert">Could not load suggestions: {{ error.message }}</p>
    <template v-else-if="suggestions">
      <p v-if="notice" class="criteria-notice" role="status">{{ notice }}</p>

      <p class="criteria-totals">
        {{ suggestions.totals.applications }} applications tracked;
        {{ suggestions.totals.analyzable }} analyzable (resolved, with requirements). Excluded:
        {{ suggestions.totals.inFlight }} in-flight,
        {{ suggestions.totals.withdrawnCensored }} withdrawn,
        {{ suggestions.totals.withoutRequirements }} without requirements.
      </p>

      <p v-if="suggestions.status === 'insufficient_data'" class="criteria-empty">
        Not enough resolved applications yet to suggest criteria changes - this needs at least
        {{ suggestions.thresholds.minResolvedAnalyzable }} analyzable applications (you have
        {{ suggestions.totals.analyzable }}).
      </p>
      <p v-else-if="suggestions.suggestions.length === 0" class="criteria-empty">
        No criteria changes are suggested - your signals track your outcomes.
      </p>
      <ul v-else class="criteria-cards">
        <li
          v-for="suggestion in suggestions.suggestions"
          :key="`${suggestion.kind}:${suggestion.category}:${suggestion.slug}`"
          class="criteria-card"
        >
          <h2>{{ headline(suggestion) }}</h2>
          <p class="criteria-observation">{{ observation(suggestion) }}</p>
          <table class="criteria-evidence">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Furthest stage</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="posting in suggestion.evidence.matchedPostings"
                :key="posting.applicationId"
              >
                <td>{{ posting.company ?? '-' }}</td>
                <td>{{ posting.title ?? 'Untitled' }}</td>
                <td>{{ posting.furthestStage }}</td>
                <td>
                  {{
                    posting.outcome === 'progressed'
                      ? 'reached a screen'
                      : 'rejected before a screen'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
          <button type="button" :disabled="applyingSlug !== null" @click="apply(suggestion)">
            {{ applyingSlug === suggestion.slug ? 'Applying…' : 'Apply to criteria' }}
          </button>
        </li>
      </ul>
    </template>

    <section v-if="audit && audit.adjustments.length > 0" class="criteria-audit">
      <h2>Past adjustments</h2>
      <ul>
        <li v-for="adjustment in audit.adjustments" :key="adjustment.id">
          Removed "{{ adjustment.slug }}"{{
            adjustment.category ? ` from ${adjustment.category}` : ''
          }}
          on {{ new Date(adjustment.createdAt).toLocaleDateString() }}.
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.criteria-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.criteria-lede,
.criteria-totals {
  color: #555;
}
.criteria-totals {
  font-size: 0.9rem;
}
.criteria-notice {
  padding: 0.5rem 0.75rem;
  background: #eef6ff;
  border-radius: 4px;
}
.criteria-cards {
  list-style: none;
  padding: 0;
}
.criteria-card {
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.criteria-observation {
  color: #333;
}
.criteria-evidence {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5rem 0 0.75rem;
  font-size: 0.9rem;
}
.criteria-evidence th,
.criteria-evidence td {
  text-align: left;
  padding: 0.2rem 0.75rem 0.2rem 0;
  border-bottom: 1px solid #eee;
}
.criteria-empty {
  color: #555;
  font-style: italic;
}
.criteria-audit {
  margin-top: 2rem;
}
</style>
