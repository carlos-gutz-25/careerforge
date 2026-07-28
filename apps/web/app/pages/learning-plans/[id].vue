<script setup lang="ts">
import type {
  EvidenceKind,
  ExerciseCaseStudyProvenance,
  ExerciseKind,
  ExerciseStatus,
  ExerciseWithEvidence,
} from '@careerforge/core';
import { ApiError } from '../../utils/api-error.ts';

// Learning plan detail (M3-01 UI, M8-12). One plan with its cited gaps, the
// user's exercises for it (M3-02 CRUD since slice 3 — add / change status /
// delete), and each exercise's mastery evidence count. Rendering law (M1-02):
// title / focus / gap fields / exercise titles are LLM/posting/user-derived
// and UNTRUSTED — {{ interpolation }} only (vue/no-v-html is a lint error).
// Review is the one-shot draft→reviewed action (the plan-section precedent).
const api = useApi();
const route = useRoute();
const planId = String(route.params.id);

// LOCAL typed vocab lists (NOT a runtime import of core's enum arrays — the
// use-api law keeps core's zod out of the web bundle, the GapSection LADDER
// precedent). The component test pins these complete against core's enums so
// they cannot drift silently.
const EXERCISE_KINDS: ExerciseKind[] = ['kata', 'project', 'writeup', 'interview_drill'];
const EXERCISE_STATUSES: ExerciseStatus[] = ['planned', 'in_progress', 'complete'];
const EVIDENCE_KINDS: EvidenceKind[] = ['implemented', 'tested', 'explained', 'revisited'];
// The wire-creatable provenance subset for a case-study draft (M4-01; the POST
// body rejects `professional`). LOCAL typed list (the use-api law keeps core's
// zod out of the bundle — the GapSection LADDER precedent), pinned complete
// against core's enum by test.
const CASE_STUDY_PROVENANCES: ExerciseCaseStudyProvenance[] = ['personal', 'personal_ai_assisted'];

// A missing/foreign plan is a 404 -> null (an expected state, not an
// exception) — the posting-detail precedent.
const { data, status, error, refresh } = useAsyncData(`learning-plan-${planId}`, () =>
  api.getLearningPlan(planId).catch((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }),
);

const plan = computed(() => data.value?.plan ?? null);
const run = computed(() => data.value?.run ?? null);
const notFound = computed(() => status.value === 'success' && data.value === null);

// One-shot review (the plan/resume/interview-section pattern).
const reviewNotes = ref('');
const reviewing = ref(false);
const reviewError = ref<string | null>(null);
async function markReviewed() {
  if (!plan.value || reviewing.value) return;
  reviewError.value = null;
  reviewing.value = true;
  try {
    await api.reviewLearningPlan(plan.value.id, {
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

// Add-exercise form (M3-02 create). gapIds are the plan's cited-gap ids
// (plan.gaps[].gapId — the underlying gap, what the server validates against);
// a new exercise must cite >=1. Title is user text (server trims + bounds 200
// + NUL-rejects); kind is one of the four. Fire-once, then refresh + reset.
const newTitle = ref('');
const newKind = ref<ExerciseKind>('kata');
const newGapIds = ref<Set<string>>(new Set());
const creating = ref(false);
const createError = ref<string | null>(null);

function toggleNewGap(gapId: string): void {
  const next = new Set(newGapIds.value);
  if (next.has(gapId)) next.delete(gapId);
  else next.add(gapId);
  newGapIds.value = next;
}

const canAddExercise = computed(
  () => newTitle.value.trim().length > 0 && newGapIds.value.size > 0 && !creating.value,
);

async function addExercise(): Promise<void> {
  if (!plan.value || !canAddExercise.value) return;
  createError.value = null;
  creating.value = true;
  try {
    await api.createExercise({
      learningPlanId: plan.value.id,
      title: newTitle.value.trim(),
      kind: newKind.value,
      gapIds: [...newGapIds.value],
    });
    newTitle.value = '';
    newKind.value = 'kata';
    newGapIds.value = new Set();
    await refresh();
  } catch (cause) {
    createError.value =
      cause instanceof ApiError ? cause.message : 'Could not add exercise. Is the API running?';
  } finally {
    creating.value = false;
  }
}

// Per-exercise status change (PATCH, the only mutable field) and delete (the
// mis-create recourse). One exercise is busy at a time; a failed status change
// (e.g. 409 complete-without-evidence) surfaces the message and refreshes back
// to server truth so the select never lies.
const busyExerciseId = ref<string | null>(null);
const exerciseError = ref<string | null>(null);

function onStatusChange(exerciseId: string, event: Event): void {
  const status = (event.target as HTMLSelectElement).value as ExerciseStatus;
  void changeStatus(exerciseId, status);
}

async function changeStatus(exerciseId: string, status: ExerciseStatus): Promise<void> {
  if (busyExerciseId.value) return;
  exerciseError.value = null;
  busyExerciseId.value = exerciseId;
  try {
    await api.updateExerciseStatus(exerciseId, { status });
    await refresh();
  } catch (cause) {
    exerciseError.value =
      cause instanceof ApiError ? cause.message : 'Status update failed. Is the API running?';
    // Re-read: the select reverts to the stored status (the 409 kept it there).
    await refresh();
  } finally {
    busyExerciseId.value = null;
  }
}

async function removeExercise(exerciseId: string): Promise<void> {
  if (busyExerciseId.value) return;
  exerciseError.value = null;
  busyExerciseId.value = exerciseId;
  try {
    await api.deleteExercise(exerciseId);
    await refresh();
  } catch (cause) {
    exerciseError.value =
      cause instanceof ApiError ? cause.message : 'Delete failed. Is the API running?';
  } finally {
    busyExerciseId.value = null;
  }
}

// Mastery evidence (M3-03). The completion gate needs >=1 `implemented` AND
// >=1 `tested` before an exercise may be `complete` (enforced server-side; the
// PATCH 409 is the hard guard). Surfacing what's present/missing here makes the
// gate visible instead of only failing on the status change.
function completion(exercise: ExerciseWithEvidence): { implemented: boolean; tested: boolean } {
  const kinds = new Set(exercise.evidence.map((row) => row.kind));
  return { implemented: kinds.has('implemented'), tested: kinds.has('tested') };
}

// One add-evidence form is open at a time (keyed by exercise). recordedOn +
// artifactUrl are optional (an `explained` record may carry no link); omit the
// empties so the server applies its recordedOn default (server today).
const addingEvidenceFor = ref<string | null>(null);
const evKind = ref<EvidenceKind>('implemented');
const evUrl = ref('');
const evDate = ref('');
const savingEvidence = ref(false);
const evidenceError = ref<string | null>(null);
const busyEvidenceId = ref<string | null>(null);

function openEvidenceForm(exerciseId: string): void {
  evidenceError.value = null;
  addingEvidenceFor.value = exerciseId;
  evKind.value = 'implemented';
  evUrl.value = '';
  evDate.value = '';
}

function cancelEvidenceForm(): void {
  addingEvidenceFor.value = null;
  evidenceError.value = null;
}

async function addEvidence(): Promise<void> {
  const exerciseId = addingEvidenceFor.value;
  if (!exerciseId || savingEvidence.value) return;
  evidenceError.value = null;
  savingEvidence.value = true;
  try {
    await api.createMasteryEvidence({
      exerciseId,
      kind: evKind.value,
      ...(evUrl.value.trim() ? { artifactUrl: evUrl.value.trim() } : {}),
      ...(evDate.value ? { recordedOn: evDate.value } : {}),
    });
    addingEvidenceFor.value = null;
    await refresh();
  } catch (cause) {
    evidenceError.value =
      cause instanceof ApiError ? cause.message : 'Could not record evidence. Is the API running?';
  } finally {
    savingEvidence.value = false;
  }
}

async function removeEvidence(evidenceId: string): Promise<void> {
  if (busyEvidenceId.value) return;
  evidenceError.value = null;
  busyEvidenceId.value = evidenceId;
  try {
    await api.deleteMasteryEvidence(evidenceId);
    await refresh();
  } catch (cause) {
    // A 409 here means the delete-guard refused (last implemented/tested of a
    // complete exercise) — surfaced as received.
    evidenceError.value =
      cause instanceof ApiError ? cause.message : 'Could not delete evidence. Is the API running?';
  } finally {
    busyEvidenceId.value = null;
  }
}

// Draft a case study (M4-01, M8-14 slice 2) FROM a `complete` exercise. The
// control appears only on completed exercises (the server also re-derives
// completion — never trusts the client). Each completed exercise has its own
// provenance choice (personal / personal_ai_assisted, the wire subset);
// `createCaseStudy` returns the draft and we navigate to it. One draft is in
// flight at a time; on success the page unmounts (navigate), on failure the
// error surfaces and the control frees.
const draftProvenance = reactive<Record<string, ExerciseCaseStudyProvenance>>({});
const draftingExerciseId = ref<string | null>(null);
const draftError = ref<string | null>(null);

function onProvenanceChange(exerciseId: string, event: Event): void {
  draftProvenance[exerciseId] = (event.target as HTMLSelectElement)
    .value as ExerciseCaseStudyProvenance;
}

async function draftCaseStudy(exerciseId: string): Promise<void> {
  if (draftingExerciseId.value) return;
  draftError.value = null;
  draftingExerciseId.value = exerciseId;
  try {
    const provenance = draftProvenance[exerciseId] ?? 'personal';
    const caseStudy = await api.createCaseStudy({ exerciseId, provenance });
    await navigateTo(`/case-studies/${caseStudy.id}`);
  } catch (cause) {
    draftError.value =
      cause instanceof ApiError
        ? cause.message
        : 'Could not draft the case study. Is the API running?';
    draftingExerciseId.value = null;
  }
}
</script>

<template>
  <div>
    <p v-if="status === 'pending'">Loading learning plan…</p>
    <p v-else-if="notFound" role="alert">
      Learning plan not found. <NuxtLink to="/learning-plans">Back to learning plans</NuxtLink>
    </p>
    <p v-else-if="error" role="alert">Could not load the plan: {{ error.message }}</p>
    <template v-else-if="plan">
      <p class="lp-back"><NuxtLink to="/learning-plans">← All learning plans</NuxtLink></p>
      <div class="lp-head">
        <h1>{{ plan.title }}</h1>
        <AppStateChip
          :variant="plan.reviewStatus === 'reviewed' ? 'reviewed' : 'draft'"
          data-testid="lp-review-chip"
        >
          {{ plan.reviewStatus }}
        </AppStateChip>
      </div>
      <pre v-if="plan.notes" class="lp-notes" data-testid="lp-notes">{{ plan.notes }}</pre>

      <h2>Cited gaps</h2>
      <ol class="lp-gaps" data-testid="lp-gaps">
        <li v-for="gap in plan.gaps" :key="gap.id" data-testid="lp-gap">
          <p class="lp-focus">{{ gap.focus }}</p>
          <p class="lp-gap-meta">
            on: {{ gap.requirementText }}
            <span class="lp-chip">{{ gap.gapClassification }}</span>
            <span class="lp-chip">priority {{ gap.priority }}</span>
            <span class="lp-chip">{{ gap.requirementCategory }}</span>
          </p>
        </li>
      </ol>

      <h2>Exercises</h2>
      <p v-if="exerciseError" role="alert" data-testid="lp-exercise-error">{{ exerciseError }}</p>
      <p v-if="evidenceError" role="alert" data-testid="lp-evidence-error">{{ evidenceError }}</p>
      <p v-if="draftError" role="alert" data-testid="lp-draft-cs-error">{{ draftError }}</p>
      <AppEmptyState v-if="plan.exercises.length === 0" data-testid="lp-no-exercises">
        No exercises yet for this plan.
      </AppEmptyState>
      <ul v-else class="lp-exercises" data-testid="lp-exercises">
        <li v-for="exercise in plan.exercises" :key="exercise.id" data-testid="lp-exercise">
          <p class="lp-exercise-title">
            {{ exercise.title }}
            <span class="lp-chip">{{ exercise.kind }}</span>
            <span class="lp-chip" data-testid="lp-exercise-status">{{ exercise.status }}</span>
          </p>
          <p class="lp-exercise-meta">
            addresses {{ exercise.gapIds.length }} gap{{
              exercise.gapIds.length === 1 ? '' : 's'
            }}
            · {{ exercise.evidence.length }} evidence
          </p>
          <div class="lp-exercise-controls">
            <label class="lp-status-label">
              Status
              <select
                :value="exercise.status"
                :disabled="busyExerciseId === exercise.id"
                data-testid="lp-exercise-status-select"
                @change="onStatusChange(exercise.id, $event)"
              >
                <option v-for="s in EXERCISE_STATUSES" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <button
              type="button"
              class="lp-exercise-delete"
              :disabled="busyExerciseId === exercise.id"
              data-testid="lp-exercise-delete"
              @click="removeExercise(exercise.id)"
            >
              Delete
            </button>
          </div>

          <p class="lp-completion-hint" data-testid="lp-completion-hint">
            To mark complete — implemented:
            {{ completion(exercise).implemented ? 'yes' : 'no' }}, tested:
            {{ completion(exercise).tested ? 'yes' : 'no' }}
          </p>

          <!-- A completed exercise can be turned into a case-study draft (M4-01,
               M8-14 slice 2). The server re-derives completion, so this control
               is a UI affordance only; it navigates to the new draft. -->
          <div
            v-if="exercise.status === 'complete'"
            class="lp-draft-cs"
            data-testid="lp-draft-case-study"
          >
            <label class="lp-draft-cs-label">
              Provenance
              <select
                :value="draftProvenance[exercise.id] ?? 'personal'"
                :disabled="draftingExerciseId === exercise.id"
                data-testid="lp-draft-cs-provenance"
                @change="onProvenanceChange(exercise.id, $event)"
              >
                <option v-for="p in CASE_STUDY_PROVENANCES" :key="p" :value="p">{{ p }}</option>
              </select>
            </label>
            <button
              type="button"
              class="lp-draft-cs-submit"
              :disabled="draftingExerciseId !== null"
              data-testid="lp-draft-cs-submit"
              @click="draftCaseStudy(exercise.id)"
            >
              {{ draftingExerciseId === exercise.id ? 'Drafting…' : 'Draft case study' }}
            </button>
          </div>

          <ul v-if="exercise.evidence.length > 0" class="lp-evidence" data-testid="lp-evidence">
            <li v-for="ev in exercise.evidence" :key="ev.id" data-testid="lp-evidence-row">
              <span class="lp-chip">{{ ev.kind }}</span>
              <span class="lp-evidence-date">{{ ev.recordedOn }}</span>
              <!-- artifactUrl is user-authored + UNTRUSTED: rendered as escaped
                   text, NEVER an <a href> (a javascript:/data: URL in an href is
                   the classic bypass of the {{ }} rendering law). -->
              <span v-if="ev.artifactUrl" class="lp-evidence-url" data-testid="lp-evidence-url">{{
                ev.artifactUrl
              }}</span>
              <button
                type="button"
                class="lp-evidence-delete"
                :disabled="busyEvidenceId === ev.id"
                data-testid="lp-evidence-delete"
                @click="removeEvidence(ev.id)"
              >
                Remove
              </button>
            </li>
          </ul>

          <div
            v-if="addingEvidenceFor === exercise.id"
            class="lp-add-evidence"
            data-testid="lp-add-evidence-form"
          >
            <label class="lp-evidence-kind-label">
              Kind
              <select v-model="evKind" :disabled="savingEvidence" data-testid="lp-evidence-kind">
                <option v-for="k in EVIDENCE_KINDS" :key="k" :value="k">{{ k }}</option>
              </select>
            </label>
            <input
              v-model="evUrl"
              :disabled="savingEvidence"
              maxlength="2048"
              placeholder="Artifact URL (optional)"
              data-testid="lp-evidence-url-input"
            />
            <input
              v-model="evDate"
              :disabled="savingEvidence"
              type="date"
              data-testid="lp-evidence-date"
            />
            <button
              type="button"
              :disabled="savingEvidence"
              data-testid="lp-evidence-submit"
              @click="addEvidence"
            >
              {{ savingEvidence ? 'Saving…' : 'Record evidence' }}
            </button>
            <button
              type="button"
              :disabled="savingEvidence"
              data-testid="lp-evidence-cancel"
              @click="cancelEvidenceForm"
            >
              Cancel
            </button>
          </div>
          <button
            v-else
            type="button"
            class="lp-add-evidence-toggle"
            data-testid="lp-add-evidence-toggle"
            @click="openEvidenceForm(exercise.id)"
          >
            Add evidence
          </button>
        </li>
      </ul>

      <div class="lp-add-exercise" data-testid="lp-add-exercise">
        <h3>Add an exercise</h3>
        <input
          v-model="newTitle"
          :disabled="creating"
          maxlength="200"
          placeholder="Exercise title"
          data-testid="lp-new-title"
        />
        <label class="lp-new-kind-label">
          Kind
          <select v-model="newKind" :disabled="creating" data-testid="lp-new-kind">
            <option v-for="k in EXERCISE_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
        </label>
        <fieldset class="lp-new-gaps">
          <legend>Gaps it addresses</legend>
          <label v-for="gap in plan.gaps" :key="gap.id" class="lp-new-gap" data-testid="lp-new-gap">
            <input
              type="checkbox"
              :checked="newGapIds.has(gap.gapId)"
              :disabled="creating"
              data-testid="lp-new-gap-checkbox"
              @change="toggleNewGap(gap.gapId)"
            />
            {{ gap.requirementText }}
          </label>
        </fieldset>
        <button
          type="button"
          :disabled="!canAddExercise"
          data-testid="lp-add-exercise-submit"
          @click="addExercise"
        >
          {{ creating ? 'Adding…' : 'Add exercise' }}
        </button>
        <p v-if="createError" role="alert" data-testid="lp-add-exercise-error">{{ createError }}</p>
      </div>

      <div v-if="plan.reviewStatus === 'draft'" class="lp-review" data-testid="lp-review-form">
        <textarea
          v-model="reviewNotes"
          :disabled="reviewing"
          placeholder="Review notes (optional)"
          data-testid="lp-review-notes"
        ></textarea>
        <button
          type="button"
          :disabled="reviewing"
          data-testid="lp-mark-reviewed"
          @click="markReviewed"
        >
          {{ reviewing ? 'Saving…' : 'Mark reviewed' }}
        </button>
        <p v-if="reviewError" role="alert" data-testid="lp-review-error">{{ reviewError }}</p>
      </div>

      <details v-if="run" class="lp-run-evidence" data-testid="lp-run-evidence">
        <summary class="lp-run-summary">Run evidence</summary>
        <p class="lp-telemetry" data-testid="lp-telemetry">
          {{ run.model }} · {{ run.promptId }} · {{ run.inputTokens }}/{{ run.outputTokens }} tok ·
          {{ run.latencyMs }} ms · {{ run.status }} · attempt {{ run.attempt }}
        </p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.lp-back {
  margin: 0 0 var(--space-2);
}
.lp-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.lp-notes {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  background: var(--color-panel);
  border-left: 3px solid var(--color-border);
  padding: 0.35rem 0.6rem;
  margin: var(--space-2) 0 var(--space-4);
  color: var(--color-text);
}
.lp-gaps,
.lp-exercises {
  padding-left: var(--space-4);
}
.lp-gaps > li,
.lp-exercises > li {
  margin-bottom: var(--space-3);
}
.lp-focus,
.lp-exercise-title {
  margin: 0 0 0.15rem;
  font-weight: 600;
}
.lp-gap-meta,
.lp-exercise-meta {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.lp-chip {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.lp-exercises {
  list-style: none;
  padding-left: 0;
}
.lp-review textarea {
  display: block;
  width: 100%;
  max-width: 32rem;
  min-height: 4rem;
  margin-bottom: var(--space-2);
}
.lp-exercise-controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: 0.25rem;
}
.lp-status-label {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.lp-status-label select {
  margin-left: 0.35rem;
}
.lp-exercise-delete {
  color: var(--color-danger);
}
.lp-add-exercise {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}
.lp-add-exercise h3 {
  margin: 0;
}
.lp-add-exercise input[type='text'],
.lp-new-title {
  width: 100%;
  max-width: 32rem;
}
.lp-new-gaps {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.lp-new-gaps legend {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.lp-new-gap {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}
.lp-completion-hint {
  margin: 0.25rem 0 0;
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.lp-draft-cs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: 0.35rem;
}
.lp-draft-cs-label {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.lp-draft-cs-label select {
  margin-left: 0.35rem;
}
.lp-evidence {
  list-style: none;
  padding: 0;
  margin: 0.35rem 0 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.lp-evidence > li {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.lp-evidence-date {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.lp-evidence-url {
  font-family: var(--font-mono);
  font-size: 0.85em;
  overflow-wrap: anywhere;
}
.lp-evidence-delete {
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}
.lp-add-evidence {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.lp-add-evidence-toggle {
  margin-top: 0.35rem;
}
.lp-run-evidence {
  margin-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-2);
}
.lp-run-summary {
  color: var(--color-muted);
  cursor: pointer;
}
.lp-telemetry {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
</style>
