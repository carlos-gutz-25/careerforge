<script setup lang="ts">
import type { FitReportResponse, Requirement } from '@careerforge/core';
import { ApiError } from '../utils/api-error.ts';

// Fit report section (M1-10). Rendering law (M1-02, same as rawText):
// {{ interpolation }} ONLY — postingQuote/profileQuote/rationale/notes are
// posting- or user-derived and untrusted as markup; v-html is a lint ERROR
// repo-wide. NO single merged "match %" is displayed or synthesized ANYWHERE
// (the story's strongest-form law; the component test pins the rendered
// section percent-free, and the wire contract cannot even carry one).
const props = defineProps<{
  report: FitReportResponse;
  /** Latest-run requirement rows (the requirements section's data) — used to
   *  show requirement TEXT for unscored ids; falls back to the id when the
   *  report's run is no longer the latest. */
  requirements: Requirement[];
}>();
const emit = defineEmits<{ reviewed: [] }>();

const api = useApi();

const requirementText = (requirementId: string): string =>
  props.requirements.find((requirement) => requirement.id === requirementId)?.text ??
  `requirement ${requirementId}`;

const dimensionLabels: Record<string, string> = {
  min_quals: 'Minimum qualifications',
  technical: 'Technical',
  domain: 'Domain',
  seniority: 'Seniority',
  comp_location: 'Comp & location',
  priority: 'Priority',
  stretch: 'Stretch',
};

const reasonLabels: Record<string, string> = {
  failed_verification: 'quote failed verification',
  not_yet_verified: 'quote not yet verified',
};

// Scores display as their honest 0–1 values (two decimals). Deliberately NOT
// rendered as percentages: per-dimension percents invite mental merging into
// the match-% this page must never show.
const formatScore = (score: number): string => score.toFixed(2);

const notes = ref('');
const reviewing = ref(false);
const reviewError = ref<string | null>(null);

async function markReviewed() {
  reviewError.value = null;
  reviewing.value = true;
  try {
    await api.reviewFitReport(props.report.id, { notes: notes.value ? notes.value : null });
    emit('reviewed');
  } catch (cause) {
    reviewError.value =
      cause instanceof ApiError ? cause.message : 'Review failed. Is the API running?';
  } finally {
    reviewing.value = false;
  }
}
</script>

<template>
  <section data-testid="fit-section">
    <h2>Fit report</h2>
    <p
      v-if="report.report.inputFlagged"
      class="fit-flagged"
      role="alert"
      data-testid="fit-input-flagged"
    >
      Input flagged: this report scored an extraction with unverified quotes — review the
      requirements section before trusting it.
    </p>

    <div v-if="report.report.verdict === 'excluded'" data-testid="fit-exclusions">
      <p class="fit-excluded" role="alert">
        Excluded by hard filter — a policy exclusion with quote evidence, not a low score.
      </p>
      <ul class="fit-exclusion-list">
        <li v-for="exclusion in report.report.exclusions" :key="exclusion.filterKey">
          <p class="fit-exclusion-head">
            {{ exclusion.filterKey }} · matched: {{ exclusion.matchedValue }}
          </p>
          <pre class="fit-quote">{{ exclusion.postingQuote }}</pre>
        </li>
      </ul>
    </div>

    <p
      v-if="report.report.forcedLowestPriority.applied"
      class="fit-forced-lowest"
      data-testid="fit-forced-lowest"
    >
      Priority capped to bottom tier (policy) — matched:
      {{ report.report.forcedLowestPriority.matchedSlugs.join(', ') }}. The priority score below
      stays the honest computed value; the cap is this flag.
    </p>

    <ol class="fit-subscore-list">
      <li
        v-for="subScore in report.report.subScores"
        :key="subScore.dimension"
        data-testid="fit-subscore"
      >
        <p class="fit-subscore-head">
          <strong>{{ dimensionLabels[subScore.dimension] ?? subScore.dimension }}</strong>
          · {{ formatScore(subScore.score) }}
          <span
            v-if="subScore.dimension === 'priority' && report.report.forcedLowestPriority.applied"
            class="fit-cap-marker"
            data-testid="fit-priority-cap-marker"
          >
            capped by policy
          </span>
        </p>
        <p class="fit-rationale">{{ subScore.rationale }}</p>
        <details
          v-for="(link, index) in subScore.evidence"
          :key="index"
          class="fit-evidence"
          data-testid="fit-evidence"
        >
          <summary>Evidence · {{ link.strength }}</summary>
          <div class="fit-evidence-quotes">
            <div>
              <p class="fit-quote-label">Posting</p>
              <pre class="fit-quote" data-testid="evidence-posting-quote">{{
                link.postingQuote
              }}</pre>
            </div>
            <div>
              <p class="fit-quote-label">Profile</p>
              <pre class="fit-quote" data-testid="evidence-profile-quote">{{
                link.profileQuote
              }}</pre>
            </div>
          </div>
        </details>
      </li>
    </ol>

    <div v-if="report.report.unscoredRequirements.length > 0" data-testid="fit-unscored">
      <p class="fit-unscored-head">
        {{ report.report.unscoredRequirements.length }} requirement{{
          report.report.unscoredRequirements.length === 1 ? '' : 's'
        }}
        excluded from scoring (verification state):
      </p>
      <ul>
        <li v-for="unscored in report.report.unscoredRequirements" :key="unscored.requirementId">
          {{ requirementText(unscored.requirementId) }}
          <span class="fit-unscored-reason">{{
            reasonLabels[unscored.reason] ?? unscored.reason
          }}</span>
        </li>
      </ul>
    </div>

    <div v-if="report.reviewStatus === 'draft'" class="fit-review" data-testid="fit-review-form">
      <p>Draft — review this report to accept it.</p>
      <textarea
        v-model="notes"
        data-testid="fit-notes"
        rows="3"
        placeholder="Review notes (optional)"
        :disabled="reviewing"
      ></textarea>
      <button
        type="button"
        data-testid="fit-mark-reviewed"
        :disabled="reviewing"
        @click="markReviewed"
      >
        {{ reviewing ? 'Marking…' : 'Mark reviewed' }}
      </button>
      <p v-if="reviewError" role="alert">{{ reviewError }}</p>
    </div>
    <div v-else data-testid="fit-reviewed">
      <p><strong>Reviewed.</strong></p>
      <pre v-if="report.notes" class="fit-notes">{{ report.notes }}</pre>
    </div>

    <p class="fit-telemetry" data-testid="fit-telemetry">
      {{ report.report.verdict }} · scored {{ new Date(report.createdAt).toLocaleString() }} · run
      {{ report.extractionRunId }} · report {{ report.id }}
    </p>
  </section>
</template>

<style scoped>
.fit-flagged,
.fit-excluded {
  /* The loud state (M1-06 precedent): louder than any amber notice. */
  background: #fdecea;
  border: 1px solid #c0392b;
  padding: 0.5rem 0.75rem;
  font-weight: 600;
}
.fit-forced-lowest {
  background: #fff8e1;
  border: 1px solid #e6d9a8;
  padding: 0.5rem 0.75rem;
}
.fit-cap-marker {
  background: #e6d9a8;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.fit-subscore-list {
  padding-left: 1.25rem;
}
.fit-subscore-head {
  margin-bottom: 0.15rem;
}
.fit-rationale {
  margin: 0 0 0.4rem;
  color: #444;
}
.fit-evidence {
  margin: 0 0 0.4rem;
}
.fit-evidence-quotes {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.fit-evidence-quotes > div {
  flex: 1 1 16rem;
}
.fit-quote-label {
  margin: 0.25rem 0 0.1rem;
  color: #555;
  font-size: 0.85em;
}
.fit-quote,
.fit-notes {
  /* Same rendering law as .posting-raw: text node + pre-wrap, no markup. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  background: #fafafa;
  border-left: 3px solid #ddd;
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.4rem;
  color: #444;
}
.fit-unscored-head {
  font-weight: 600;
  color: #c0392b;
}
.fit-unscored-reason {
  background: #c0392b;
  color: #fff;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.fit-review textarea {
  display: block;
  width: 100%;
  max-width: 40rem;
  margin: 0.4rem 0;
}
.fit-telemetry {
  color: #555;
}
</style>
