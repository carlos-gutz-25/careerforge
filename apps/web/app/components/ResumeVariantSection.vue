<script setup lang="ts">
import type { FitReportResponse, ResumeEmphasisLevel, ResumeEntityType } from '@careerforge/core';
import { ApiError } from '../utils/api-error.ts';

// Resume variant section (M2-10, pin-to-report). This is a tailoring/emphasis
// GUIDE over verified profile content, not a submittable bulleted resume.
// Rendering law (M1-02, same as rawText): {{ interpolation }} ONLY — the
// `reason` is LLM-generated and the citation requirement fields are
// posting-derived; all untrusted as markup (v-html is a lint ERROR repo-wide),
// including the rendered_markdown preview (a <pre> text node). The draft
// trigger is review-gated and fire-once (the paid call runs 10-20 s). Export is
// offered ONLY on a reviewed variant.
const props = defineProps<{ reportId: string; report: FitReportResponse }>();

const api = useApi();

const { data, refresh } = useAsyncData(`fit-report-${props.reportId}-resume-variant`, () =>
  api.getFitReportResumeVariant(props.reportId).catch(() => null),
);

// Deliberately LOCAL typed lists, not runtime imports of core's enums (the
// M1-11 vite-optimizer law). The component test pins both complete against
// core's enums.
const SECTIONS: ResumeEntityType[] = ['skill', 'experience', 'project'];

const sectionLabels: Record<ResumeEntityType, string> = {
  skill: 'Skills',
  experience: 'Experience',
  project: 'Projects',
};
// A Record keyed by the core union: TS rejects an incomplete map, so the
// emphasis vocabulary can never drift silently (the component test pins the
// rendered chips against RESUME_EMPHASIS_LEVELS too).
const emphasisLabels: Record<ResumeEmphasisLevel, string> = {
  lead: 'lead',
  highlight: 'highlight',
};

const variant = computed(() => data.value?.variant ?? null);
const run = computed(() => data.value?.run ?? null);

const grouped = computed(() =>
  SECTIONS.map((section) => ({
    section,
    entries: (variant.value?.entries ?? []).filter((entry) => entry.section === section),
  })).filter((group) => group.entries.length > 0),
);

// A failed/flagged tailoring run leaves a run with NO variant — the loud state.
const failedRun = computed(() => (variant.value === null && run.value !== null ? run.value : null));

// Draft trigger (fire-once pending; the template gates on variant===null AND
// report.reviewStatus==='reviewed').
const drafting = ref(false);
const draftError = ref<string | null>(null);
async function draftVariant() {
  if (drafting.value) return;
  draftError.value = null;
  drafting.value = true;
  try {
    await api.draftResumeVariant(props.reportId);
    await refresh();
  } catch (cause) {
    draftError.value =
      cause instanceof ApiError ? cause.message : 'Tailoring failed. Is the API running?';
  } finally {
    drafting.value = false;
  }
}

// One-shot review (the plan-section pattern).
const reviewNotes = ref('');
const reviewing = ref(false);
const reviewError = ref<string | null>(null);
async function markReviewed() {
  if (!variant.value || reviewing.value) return;
  reviewError.value = null;
  reviewing.value = true;
  try {
    await api.reviewResumeVariant(variant.value.id, {
      notes: reviewNotes.value ? reviewNotes.value : null,
    });
    await refresh();
  } catch (cause) {
    reviewError.value =
      cause instanceof ApiError ? cause.message : 'Review failed. Is the API running?';
  } finally {
    reviewing.value = false;
  }
}

// Export = a browser download (only a reviewed variant exports).
const exporting = ref(false);
const exportError = ref<string | null>(null);
async function exportVariant() {
  if (!variant.value || exporting.value) return;
  exportError.value = null;
  exporting.value = true;
  try {
    await api.exportResumeVariant(variant.value.id);
  } catch (cause) {
    exportError.value =
      cause instanceof ApiError ? cause.message : 'Export failed. Is the API running?';
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <section v-if="data" data-testid="resume-variant-section">
    <h2>Resume variant</h2>
    <p class="rv-blurb">
      A tailoring and emphasis guide over your verified profile content for this posting — a
      reordering with cited emphasis, not a submittable resume.
    </p>

    <p v-if="failedRun" class="rv-failed" role="alert" data-testid="rv-failed-run">
      The last tailoring run did not produce a variant (status: {{ failedRun.status }}).
      <template v-if="failedRun.status === 'flagged'">
        The model returned a spec that dropped or fabricated an entry — it was rejected and the run
        flagged.
      </template>
      Tailoring again is a fresh paid call.
    </p>

    <template v-if="variant === null">
      <p v-if="report.reviewStatus !== 'reviewed'" data-testid="rv-review-gate">
        Review the fit report first — variants tailor from the reviewed classifications.
      </p>
      <button
        v-else
        type="button"
        :disabled="drafting"
        data-testid="rv-draft-button"
        @click="draftVariant"
      >
        {{ drafting ? 'Tailoring… (10–20 s, one paid call)' : 'Tailor resume variant' }}
      </button>
      <p v-if="draftError" role="alert" data-testid="rv-draft-error">{{ draftError }}</p>
    </template>

    <template v-else>
      <p class="rv-meta" data-testid="rv-meta">
        <span
          v-if="variant.reviewStatus === 'draft'"
          class="rv-draft-chip"
          data-testid="rv-draft-chip"
        >
          draft — review before exporting it
        </span>
        <span v-else class="rv-reviewed-chip" data-testid="rv-reviewed-chip">Reviewed.</span>
      </p>
      <pre v-if="variant.notes" class="rv-notes" data-testid="rv-notes">{{ variant.notes }}</pre>

      <div v-for="group in grouped" :key="group.section" data-testid="rv-group">
        <h3>
          {{ sectionLabels[group.section] }}
          <span class="rv-count">{{ group.entries.length }}</span>
        </h3>
        <ul class="rv-list">
          <li v-for="entry in group.entries" :key="entry.id" data-testid="rv-entry">
            <p class="rv-entry-label">
              {{ entry.label }}
              <span
                v-if="entry.emphasis"
                class="rv-chip rv-emphasis"
                data-testid="rv-entry-emphasis"
                >{{ emphasisLabels[entry.emphasis] }}</span
              >
            </p>
            <p v-if="entry.detail" class="rv-entry-detail">{{ entry.detail }}</p>
            <p v-if="entry.reason" class="rv-entry-reason" data-testid="rv-entry-reason">
              why emphasized: {{ entry.reason }}
            </p>
            <details v-if="entry.citations.length > 0" data-testid="rv-entry-citations">
              <summary>Cited requirements ({{ entry.citations.length }})</summary>
              <ul>
                <li v-for="citation in entry.citations" :key="citation.gapId">
                  <p class="rv-cite">
                    {{ citation.requirementText }}
                    <span class="rv-chip">{{ citation.gapClassification }}</span>
                    <span class="rv-chip">{{ citation.requirementKind }}</span>
                  </p>
                </li>
              </ul>
            </details>
          </li>
        </ul>
      </div>

      <h3>Markdown preview</h3>
      <pre class="rv-preview" data-testid="rv-preview">{{ variant.renderedMarkdown }}</pre>

      <div v-if="variant.reviewStatus === 'draft'" class="rv-review" data-testid="rv-review-form">
        <textarea
          v-model="reviewNotes"
          :disabled="reviewing"
          placeholder="Review notes (optional)"
          data-testid="rv-review-notes"
        ></textarea>
        <button
          type="button"
          :disabled="reviewing"
          data-testid="rv-mark-reviewed"
          @click="markReviewed"
        >
          {{ reviewing ? 'Saving…' : 'Mark reviewed' }}
        </button>
        <p v-if="reviewError" role="alert" data-testid="rv-review-error">{{ reviewError }}</p>
      </div>

      <div v-else class="rv-export" data-testid="rv-export-form">
        <button
          type="button"
          :disabled="exporting"
          data-testid="rv-export-button"
          @click="exportVariant"
        >
          {{ exporting ? 'Exporting…' : 'Export markdown' }}
        </button>
        <p v-if="exportError" role="alert" data-testid="rv-export-error">{{ exportError }}</p>
      </div>
    </template>

    <p v-if="run" class="rv-telemetry" data-testid="rv-telemetry">
      {{ run.model }} · {{ run.promptId }} · {{ run.inputTokens }}/{{ run.outputTokens }} tok ·
      {{ run.latencyMs }} ms · {{ run.status }} · attempt {{ run.attempt }}
    </p>
  </section>
</template>

<style scoped>
.rv-blurb {
  color: #555;
  margin: 0 0 0.6rem;
}
.rv-failed {
  background: #fdecea;
  border: 1px solid #c0392b;
  padding: 0.5rem 0.75rem;
  font-weight: 600;
}
.rv-draft-chip {
  background: #fff8e1;
  border: 1px solid #e6d9a8;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.9em;
}
.rv-reviewed-chip {
  background: #eafaf1;
  border: 1px solid #27ae60;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.9em;
}
.rv-count {
  background: #eee;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.8em;
  margin-left: 0.35rem;
}
.rv-list {
  padding-left: 1.25rem;
}
.rv-entry-label {
  margin-bottom: 0.1rem;
  font-weight: 600;
}
.rv-entry-detail {
  margin: 0 0 0.15rem;
  color: #444;
}
.rv-entry-reason {
  margin: 0 0 0.15rem;
  color: #555;
  font-style: italic;
}
.rv-chip {
  background: #eee;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.rv-emphasis {
  background: #eef3ff;
  border: 1px solid #b8ccf0;
}
.rv-cite {
  margin: 0 0 0.3rem;
  color: #444;
}
.rv-notes,
.rv-preview {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #fafafa;
  border-left: 3px solid #ddd;
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.4rem;
  color: #333;
}
.rv-preview {
  max-height: 24rem;
  overflow: auto;
}
.rv-review textarea {
  display: block;
  width: 100%;
  max-width: 32rem;
  min-height: 4rem;
  margin-bottom: 0.4rem;
}
.rv-telemetry {
  color: #777;
  font-size: 0.85em;
  border-top: 1px solid #eee;
  padding-top: 0.4rem;
}
</style>
