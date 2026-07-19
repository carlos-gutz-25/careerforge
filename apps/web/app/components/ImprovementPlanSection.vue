<script setup lang="ts">
import type {
  FitReportResponse,
  PlanItemPriority,
  PlanItemResponse,
  PlanItemStatus,
} from '@careerforge/core';
import { ApiError } from '../utils/api-error.ts';

// Improvement plan section (M1-12). Rendering law (M1-02, same as rawText):
// {{ interpolation }} ONLY — action text is LLM-generated and requirement /
// evidence fields are posting-derived; all untrusted as markup (v-html is a
// lint ERROR repo-wide). The section is report-scoped (pin-to-report) and
// the host remounts it per report via :key. The draft trigger is
// review-gated and fire-once (the extract-trigger pattern: the call can run
// 10-20 s, the page shows a pending state).
const props = defineProps<{ reportId: string; report: FitReportResponse }>();

const api = useApi();

const { data, refresh } = useAsyncData(`fit-report-${props.reportId}-plan`, () =>
  api.getFitReportPlan(props.reportId).catch(() => null),
);

// Deliberately LOCAL typed lists, not runtime imports of core's enums: the
// web bundle imports core TYPES ONLY (the M1-11 vite-optimizer law). The
// component test pins both lists complete against core's enums.
const PRIORITIES: PlanItemPriority[] = ['high', 'medium', 'low'];
const STATUSES: PlanItemStatus[] = ['planned', 'in_progress', 'complete', 'dropped'];

const priorityLabels: Record<PlanItemPriority, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

const statusLabels: Record<PlanItemStatus, string> = {
  planned: 'planned',
  in_progress: 'in progress',
  complete: 'complete',
  dropped: 'dropped',
};

const plan = computed(() => data.value?.plan ?? null);
const run = computed(() => data.value?.run ?? null);

const grouped = computed(() =>
  PRIORITIES.map((priority) => ({
    priority,
    items: (plan.value?.items ?? []).filter((item) => item.priority === priority),
  })).filter((group) => group.items.length > 0),
);

/** Evidence for an item's cited gap, from the ALREADY-FETCHED report payload
 *  (requirement-keyed; no extra wire call — plan §4). Each entry keeps its
 *  owning sub-score DIMENSION: the scoring model legitimately persists the
 *  same link content under two sub-scores (technical selects by category;
 *  stretch re-emits non-direct pool links for near-reach nice_to_haves), so
 *  two same-looking rows are two real citations — labeling each with its
 *  dimension keeps the fold self-explaining and the count honest, with no
 *  dedupe (the leg-2 twin-evidence finding, slice 5.1). */
const evidenceByRequirement = computed(() => {
  const map = new Map<
    string,
    { postingQuote: string; profileQuote: string; strength: string; dimension: string }[]
  >();
  for (const subScore of props.report.report.subScores) {
    for (const link of subScore.evidence) {
      const bucket = map.get(link.requirementId);
      const entry = {
        postingQuote: link.postingQuote,
        profileQuote: link.profileQuote,
        strength: link.strength,
        dimension: subScore.dimension,
      };
      if (bucket) bucket.push(entry);
      else map.set(link.requirementId, [entry]);
    }
  }
  return map;
});

// A failed/flagged draft leaves a run with NO plan — the loud state.
const failedRun = computed(() => (plan.value === null && run.value !== null ? run.value : null));

// Draft trigger (fire-once pending, the M1-10 pattern; the template gates
// the button on plan===null AND report.reviewStatus==='reviewed').
const drafting = ref(false);
const draftError = ref<string | null>(null);
async function draftPlan() {
  if (drafting.value) return;
  draftError.value = null;
  drafting.value = true;
  try {
    await api.draftImprovementPlan(props.reportId);
    await refresh();
  } catch (cause) {
    draftError.value =
      cause instanceof ApiError ? cause.message : 'Drafting failed. Is the API running?';
  } finally {
    drafting.value = false;
  }
}

// Per-item editor (fire-once pending; A2 full replacement of the two
// mutable fields — action/gap/position are immutable draft content).
const editingItemId = ref<string | null>(null);
const statusDraft = ref<PlanItemStatus>('planned');
const priorityDraft = ref<PlanItemPriority>('medium');
const savingItem = ref(false);
const itemError = ref<string | null>(null);

function startItemEdit(item: PlanItemResponse) {
  itemError.value = null;
  editingItemId.value = item.id;
  statusDraft.value = item.status;
  priorityDraft.value = item.priority;
}

function cancelItemEdit() {
  editingItemId.value = null;
  itemError.value = null;
}

async function saveItem() {
  if (!editingItemId.value || savingItem.value) return;
  itemError.value = null;
  savingItem.value = true;
  try {
    await api.updatePlanItem(editingItemId.value, {
      status: statusDraft.value,
      priority: priorityDraft.value,
    });
    editingItemId.value = null;
    await refresh();
  } catch (cause) {
    itemError.value =
      cause instanceof ApiError ? cause.message : 'Update failed. Is the API running?';
  } finally {
    savingItem.value = false;
  }
}

// One-shot review (the FitReportSection pattern).
const reviewNotes = ref('');
const reviewing = ref(false);
const reviewError = ref<string | null>(null);
async function markReviewed() {
  if (!plan.value || reviewing.value) return;
  reviewError.value = null;
  reviewing.value = true;
  try {
    await api.reviewImprovementPlan(plan.value.id, {
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

function itemEvidence(item: PlanItemResponse) {
  return evidenceByRequirement.value.get(item.gapRequirementId) ?? [];
}
</script>

<template>
  <section v-if="data" data-testid="plan-section">
    <h2>Improvement plan</h2>

    <p v-if="failedRun" class="plan-failed" role="alert" data-testid="plan-failed-run">
      The last drafting run did not produce a plan (status: {{ failedRun.status }}).
      <template v-if="failedRun.status === 'flagged'">
        The model cited a gap that was never sent — the draft was rejected and the run flagged.
      </template>
      Drafting again is a fresh paid call.
    </p>

    <template v-if="plan === null">
      <p v-if="report.reviewStatus !== 'reviewed'" data-testid="plan-review-gate">
        Review the fit report first — plans draft from the reviewed classifications.
      </p>
      <button
        v-else
        type="button"
        :disabled="drafting"
        data-testid="plan-draft-button"
        @click="draftPlan"
      >
        {{ drafting ? 'Drafting… (10–20 s, one paid call)' : 'Draft improvement plan' }}
      </button>
      <p v-if="draftError" role="alert" data-testid="plan-draft-error">{{ draftError }}</p>
    </template>

    <template v-else>
      <p class="plan-meta" data-testid="plan-meta">
        <span
          v-if="plan.reviewStatus === 'draft'"
          class="plan-draft-chip"
          data-testid="plan-draft-chip"
        >
          draft — review before acting on it
        </span>
        <span v-else class="plan-reviewed-chip" data-testid="plan-reviewed-chip">Reviewed.</span>
      </p>
      <pre v-if="plan.notes" class="plan-notes" data-testid="plan-notes">{{ plan.notes }}</pre>

      <div v-for="group in grouped" :key="group.priority" data-testid="plan-group">
        <h3>
          {{ priorityLabels[group.priority] }}
          <span class="plan-count">{{ group.items.length }}</span>
        </h3>
        <ul class="plan-list">
          <li v-for="item in group.items" :key="item.id" data-testid="plan-item">
            <p class="plan-action">
              {{ item.action }}
              <span class="plan-chip" data-testid="plan-item-status">{{
                statusLabels[item.status]
              }}</span>
            </p>
            <p class="plan-gap-cite" data-testid="plan-item-gap">
              cites: {{ item.requirementText }}
              <span class="plan-chip">{{ item.gapClassification }}</span>
              <span class="plan-chip">{{ item.requirementKind }}</span>
            </p>
            <details v-if="itemEvidence(item).length > 0" data-testid="plan-item-evidence">
              <summary>Evidence ({{ itemEvidence(item).length }})</summary>
              <ul>
                <li v-for="(link, index) in itemEvidence(item)" :key="index">
                  <p class="plan-quote">posting: {{ link.postingQuote }}</p>
                  <p class="plan-quote">profile: {{ link.profileQuote }}</p>
                  <p class="plan-quote-strength">
                    strength: {{ link.strength }} · via {{ link.dimension }}
                  </p>
                </li>
              </ul>
            </details>

            <div
              v-if="editingItemId === item.id"
              class="plan-editor"
              data-testid="plan-item-editor"
            >
              <label>
                Status
                <select
                  v-model="statusDraft"
                  :disabled="savingItem"
                  data-testid="plan-status-select"
                >
                  <option v-for="value in STATUSES" :key="value" :value="value">
                    {{ statusLabels[value] }}
                  </option>
                </select>
              </label>
              <label>
                Priority
                <select
                  v-model="priorityDraft"
                  :disabled="savingItem"
                  data-testid="plan-priority-select"
                >
                  <option v-for="value in PRIORITIES" :key="value" :value="value">
                    {{ priorityLabels[value] }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                :disabled="savingItem"
                data-testid="plan-item-save"
                @click="saveItem"
              >
                {{ savingItem ? 'Saving…' : 'Save' }}
              </button>
              <button
                type="button"
                :disabled="savingItem"
                data-testid="plan-item-cancel"
                @click="cancelItemEdit"
              >
                Cancel
              </button>
              <p v-if="itemError" role="alert" data-testid="plan-item-error">{{ itemError }}</p>
            </div>
            <button
              v-else
              type="button"
              class="plan-item-edit-button"
              data-testid="plan-item-edit-button"
              @click="startItemEdit(item)"
            >
              Update status
            </button>
          </li>
        </ul>
      </div>

      <div v-if="plan.reviewStatus === 'draft'" class="plan-review" data-testid="plan-review-form">
        <textarea
          v-model="reviewNotes"
          :disabled="reviewing"
          placeholder="Review notes (optional)"
          data-testid="plan-review-notes"
        ></textarea>
        <button
          type="button"
          :disabled="reviewing"
          data-testid="plan-mark-reviewed"
          @click="markReviewed"
        >
          {{ reviewing ? 'Saving…' : 'Mark reviewed' }}
        </button>
        <p v-if="reviewError" role="alert" data-testid="plan-review-error">{{ reviewError }}</p>
      </div>
    </template>

    <p v-if="run" class="plan-telemetry" data-testid="plan-telemetry">
      {{ run.model }} · {{ run.promptId }} · {{ run.inputTokens }}/{{ run.outputTokens }} tok ·
      {{ run.latencyMs }} ms · {{ run.status }} · attempt {{ run.attempt }}
    </p>
  </section>
</template>

<style scoped>
.plan-failed {
  /* The loud state (M1-06 precedent). */
  background: #fdecea;
  border: 1px solid #c0392b;
  padding: 0.5rem 0.75rem;
  font-weight: 600;
}
.plan-draft-chip {
  background: #fff8e1;
  border: 1px solid #e6d9a8;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.9em;
}
.plan-reviewed-chip {
  background: #eafaf1;
  border: 1px solid #27ae60;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.9em;
}
.plan-count {
  background: #eee;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.8em;
  margin-left: 0.35rem;
}
.plan-list {
  padding-left: 1.25rem;
}
.plan-action {
  margin-bottom: 0.15rem;
}
.plan-chip {
  background: #eee;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.plan-gap-cite {
  margin: 0 0 0.4rem;
  color: #444;
}
.plan-quote {
  margin: 0;
  color: #444;
}
.plan-quote-strength {
  margin: 0 0 0.4rem;
  color: #777;
  font-size: 0.9em;
}
.plan-notes {
  /* Same rendering law as .gap-note: text node + pre-wrap, no markup. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  background: #fafafa;
  border-left: 3px solid #ddd;
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.4rem;
  color: #444;
}
.plan-editor select {
  margin-right: 0.5rem;
}
.plan-editor button,
.plan-item-edit-button {
  margin-right: 0.5rem;
}
.plan-review textarea {
  display: block;
  width: 100%;
  max-width: 32rem;
  min-height: 4rem;
  margin-bottom: 0.4rem;
}
.plan-telemetry {
  color: #777;
  font-size: 0.85em;
  border-top: 1px solid #eee;
  padding-top: 0.4rem;
}
</style>
