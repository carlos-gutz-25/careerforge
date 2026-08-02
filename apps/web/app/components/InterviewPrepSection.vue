<script setup lang="ts">
import type { FitReportResponse, InterviewQuestionKind } from '@careerforge/core';
import { ApiError } from '../utils/api-error.ts';

// Interview prep section (M3-04 UI, M8-11). An LLM-DRAFTED set of likely
// questions per verified requirement, each with talking points that are
// either CITED evidence (a sent evidence link) or an HONEST gap disclosure
// (the gap row's live classification, server-resolved — never invented
// experience). Pin-to-report: one prep per fit report, reached through the
// posting (the route resolves the posting's latest report). Rendering law
// (M1-02, same as rawText): {{ interpolation }} ONLY — question/point text is
// LLM-generated and the joined requirement/quote fields are posting-derived;
// all untrusted as markup (v-html is a lint ERROR repo-wide). The draft
// trigger is review-gated (the report must be reviewed) and fire-once (the
// paid call runs 10-20 s). No export — prep is a study guide, not a document.
const props = defineProps<{ postingId: string; report: FitReportResponse }>();

const api = useApi();
// M10-04, D4: demo instances disable this LLM-draft POST (server enforces; the
// disabled button + demoAwareErrorMessage belt are the UI honesty layer).
const { demo } = useDemoMode();

// Keyed by the report id so a re-score (new report) refetches: the prep is
// per-report and the workspace remounts this section on report change.
const { data, refresh } = useAsyncData(`interview-prep-${props.report.id}`, () =>
  api.getInterviewPrep(props.postingId).catch(() => null),
);

// A Record keyed by the core union: TS rejects an incomplete map, so the
// question-kind vocabulary can never drift silently (the component test pins
// the rendered labels against INTERVIEW_QUESTION_KINDS).
const questionKindLabels: Record<InterviewQuestionKind, string> = {
  technical: 'technical',
  behavioral: 'behavioral',
};

const prep = computed(() => data.value?.prep ?? null);
const run = computed(() => data.value?.run ?? null);

// A failed/flagged drafting run leaves a run with NO prep — the loud state
// (the resume-variant failedRun precedent).
const failedRun = computed(() => (prep.value === null && run.value !== null ? run.value : null));

// Draft trigger (fire-once pending; the template gates on prep===null AND
// report.reviewStatus==='reviewed').
const drafting = ref(false);
const draftError = ref<string | null>(null);
async function draftPrep() {
  if (drafting.value) return;
  draftError.value = null;
  drafting.value = true;
  try {
    await api.draftInterviewPrep(props.postingId);
    await refresh();
  } catch (cause) {
    draftError.value = demoAwareErrorMessage(cause, 'Drafting failed. Is the API running?');
  } finally {
    drafting.value = false;
  }
}

// One-shot review (the plan/resume-section pattern).
const reviewNotes = ref('');
const reviewing = ref(false);
const reviewError = ref<string | null>(null);
async function markReviewed() {
  if (!prep.value || reviewing.value) return;
  reviewError.value = null;
  reviewing.value = true;
  try {
    await api.reviewInterviewPrep(prep.value.id, {
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
</script>

<template>
  <section v-if="data" data-testid="interview-prep-section">
    <h2>Interview prep</h2>
    <p class="ip-blurb">
      Likely questions for this posting's verified requirements, each with talking points drawn from
      cited evidence or an honest gap disclosure — a study guide, never a script.
    </p>

    <p v-if="failedRun" class="ip-failed" role="alert" data-testid="ip-failed-run">
      The last drafting run did not produce a prep (status: {{ failedRun.status }}).
      <template v-if="failedRun.status === 'flagged'">
        The model cited a requirement or evidence link it was not given — it was rejected and the
        run flagged.
      </template>
      Drafting again is a fresh paid call.
    </p>

    <template v-if="prep === null">
      <p v-if="report.reviewStatus !== 'reviewed'" data-testid="ip-review-gate">
        Review the fit report first — interview prep draws on the reviewed classifications.
      </p>
      <button
        v-else
        type="button"
        :disabled="drafting || demo"
        data-testid="ip-draft-button"
        @click="draftPrep"
      >
        {{ drafting ? 'Drafting… (10–20 s, one paid call)' : 'Draft interview prep' }}
      </button>
      <AppStateChip v-if="demo" variant="info" data-testid="ip-demo-note">{{
        DEMO_DISABLED_CHIP
      }}</AppStateChip>
      <p v-if="draftError" role="alert" data-testid="ip-draft-error">{{ draftError }}</p>
      <AppSkeleton v-if="drafting" :lines="5" data-testid="ip-drafting-skeleton" />
    </template>

    <template v-else>
      <p class="ip-meta" data-testid="ip-meta">
        <span
          v-if="prep.reviewStatus === 'draft'"
          class="ip-draft-chip"
          data-testid="ip-draft-chip"
        >
          draft — review before trusting it
        </span>
        <span v-else class="ip-reviewed-chip" data-testid="ip-reviewed-chip">Reviewed.</span>
      </p>
      <pre v-if="prep.notes" class="ip-notes" data-testid="ip-notes">{{ prep.notes }}</pre>

      <ol class="ip-list">
        <li v-for="question in prep.questions" :key="question.id" data-testid="ip-question">
          <p class="ip-question-text">
            <span class="ip-kind-chip" data-testid="ip-question-kind">{{
              questionKindLabels[question.kind]
            }}</span>
            {{ question.question }}
          </p>
          <p class="ip-requirement" data-testid="ip-requirement">
            on: {{ question.requirementText }}
            <span class="ip-chip">{{
              question.requirementKind === 'must_have' ? 'must have' : 'nice to have'
            }}</span>
            <span class="ip-chip">{{ question.requirementCategory }}</span>
          </p>
          <ul class="ip-points">
            <li v-for="point in question.points" :key="point.id" data-testid="ip-point">
              <template v-if="point.type === 'evidence'">
                <p class="ip-point-text">
                  {{ point.text }}
                  <span class="ip-chip ip-evidence-chip" data-testid="ip-evidence-strength">{{
                    point.evidenceStrength
                  }}</span>
                </p>
                <details data-testid="ip-evidence-detail">
                  <summary>Cited evidence</summary>
                  <p class="ip-quote-label">From the posting</p>
                  <pre class="ip-quote" data-testid="ip-posting-quote">{{
                    point.evidencePostingQuote
                  }}</pre>
                  <p class="ip-quote-label">From your profile</p>
                  <pre class="ip-quote" data-testid="ip-profile-quote">{{
                    point.evidenceProfileQuote
                  }}</pre>
                </details>
              </template>
              <template v-else>
                <p class="ip-point-text">
                  {{ point.text }}
                  <span class="ip-chip ip-gap-chip" data-testid="ip-gap-classification">{{
                    point.gapClassification
                  }}</span>
                </p>
                <p
                  v-if="point.learningPlans.length > 0"
                  class="ip-learning"
                  data-testid="ip-learning-plans"
                >
                  Planned in:
                  <NuxtLink
                    v-for="plan in point.learningPlans"
                    :key="plan.id"
                    :to="`/learning-plans/${plan.id}`"
                    class="ip-plan-link"
                    data-testid="ip-learning-plan"
                  >
                    {{ plan.title }}
                  </NuxtLink>
                </p>
              </template>
            </li>
          </ul>
        </li>
      </ol>

      <div v-if="prep.reviewStatus === 'draft'" class="ip-review" data-testid="ip-review-form">
        <textarea
          v-model="reviewNotes"
          :disabled="reviewing"
          placeholder="Review notes (optional)"
          data-testid="ip-review-notes"
        ></textarea>
        <button
          type="button"
          :disabled="reviewing"
          data-testid="ip-mark-reviewed"
          @click="markReviewed"
        >
          {{ reviewing ? 'Saving…' : 'Mark reviewed' }}
        </button>
        <p v-if="reviewError" role="alert" data-testid="ip-review-error">{{ reviewError }}</p>
      </div>
      <div v-else class="ip-reviewed" data-testid="ip-reviewed">
        <p v-if="prep.notes" class="ip-reviewed-note">Reviewed with notes above.</p>
        <p v-else class="ip-reviewed-note">Reviewed.</p>
      </div>
    </template>

    <!-- Run Evidence (M8-10 idiom): the drafting run's provenance, collapsed. -->
    <details v-if="run" class="ip-run-evidence" data-testid="ip-run-evidence">
      <summary class="ip-run-summary">Run evidence</summary>
      <p class="ip-telemetry" data-testid="ip-telemetry">
        {{ run.model }} · {{ run.promptId }} · {{ run.inputTokens }}/{{ run.outputTokens }} tok ·
        {{ run.latencyMs }} ms · {{ run.status }} · attempt {{ run.attempt }}
      </p>
    </details>
  </section>
</template>

<style scoped>
.ip-blurb {
  color: var(--color-muted);
  margin: 0 0 0.6rem;
}
.ip-failed {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger);
  padding: 0.5rem 0.75rem;
  font-weight: 600;
}
.ip-draft-chip {
  background: var(--color-draft-bg);
  border: 1px solid var(--color-accent);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.9em;
}
.ip-reviewed-chip {
  background: var(--color-reviewed-bg);
  border: 1px solid var(--color-reviewed);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.9em;
}
.ip-list {
  padding-left: 1.25rem;
}
.ip-list > li {
  margin-bottom: 0.75rem;
}
.ip-question-text {
  margin-bottom: 0.1rem;
  font-weight: 600;
}
.ip-requirement {
  margin: 0 0 0.25rem;
  color: var(--color-muted);
  font-size: 0.9em;
}
.ip-points {
  padding-left: 1.25rem;
}
.ip-point-text {
  margin: 0 0 0.15rem;
  color: var(--color-text);
}
.ip-kind-chip {
  background: var(--color-info-bg);
  border: 1px solid var(--color-info);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.8em;
  margin-right: 0.35rem;
}
.ip-chip {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.ip-gap-chip {
  background: var(--color-draft-bg);
  border-color: var(--color-accent);
}
.ip-quote-label {
  margin: 0.25rem 0 0.1rem;
  color: var(--color-muted);
  font-size: 0.8em;
}
.ip-learning {
  margin: 0 0 0.15rem;
  color: var(--color-muted);
  font-size: 0.9em;
}
.ip-plan-link {
  margin-left: 0.35rem;
}
.ip-notes,
.ip-quote {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  background: var(--color-panel);
  border-left: 3px solid var(--color-border);
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.4rem;
  color: var(--color-text);
}
.ip-review textarea {
  display: block;
  width: 100%;
  max-width: 32rem;
  min-height: 4rem;
  margin-bottom: 0.4rem;
}
.ip-run-evidence {
  margin-top: 0.6rem;
  border-top: 1px solid var(--color-border);
  padding-top: 0.4rem;
}
.ip-run-summary {
  color: var(--color-muted);
  cursor: pointer;
}
.ip-telemetry {
  color: var(--color-muted);
  font-size: 0.85em;
}
</style>
