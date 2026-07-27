<script setup lang="ts">
import type { FitReportResponse, GapResponse, LearningPlanRun } from '@careerforge/core';
import { ApiError } from '../utils/api-error.ts';

// Create-plan-from-gaps section (M3-01 UI, M8-12 slice 2). The affordance the
// slice-1 pages point at: pick this fit report's actionable gaps and draft a
// FREE-CREATE learning plan over them (POST /learning-plans, ADR-0013). It is
// report-scoped — the Gaps stage renders one report at a time, so every
// selected gap shares this report and the reviewed-gate is the single
// `report.reviewStatus` check (the server re-checks EVERY selected gap's
// source report and 409s REPORTS_NOT_REVIEWED if any is unreviewed; the
// client mirrors that honestly rather than firing a call it knows will fail).
//
// Only NON-`have` gaps are offered: the payload builder drops `have` gaps as
// non-actionable, and a selection with no actionable gaps is a 409
// NO_ACTIONABLE_GAPS before any paid call. Rendering law (M1-02, same as
// rawText): requirementText is posting-derived — {{ interpolation }} ONLY
// (v-html is a lint ERROR repo-wide). Drafting is a PAID LLM call (10-20 s):
// the button fires once and shows a pending state; a citation-flagged run
// comes back 201 with `plan: null` (a RESULT, not a transport error) and is
// surfaced as a loud banner, never a thrown error.
const props = defineProps<{ reportId: string; report: FitReportResponse }>();

const api = useApi();

// Shares GapSection's useAsyncData key on purpose: both render in the Gaps
// panel keyed to the same report, so this reuses the one cached gap payload
// instead of issuing a duplicate GET (the fetcher is identical; Nuxt dedupes
// by key). Fetch failure degrades to no section (the section-pattern law).
const { data } = useAsyncData(`fit-report-${props.reportId}-gaps`, () =>
  api.getFitReportGaps(props.reportId).catch(() => null),
);

// Actionable = every classification the payload builder keeps (non-`have`);
// `have` requirements are already covered and seed nothing.
const eligibleGaps = computed<GapResponse[]>(() =>
  (data.value?.gaps ?? []).filter((gap) => gap.classification !== 'have'),
);

// Selection defaults to ALL eligible gaps (the common case: draft a plan for
// everything actionable on this report). Seeded once when the gaps first load;
// the user then toggles individual rows or uses select-all / clear.
const selected = ref<Set<string>>(new Set());
let seeded = false;
watch(
  eligibleGaps,
  (gaps) => {
    if (!seeded && gaps.length > 0) {
      selected.value = new Set(gaps.map((gap) => gap.id));
      seeded = true;
    }
  },
  { immediate: true },
);

const selectedCount = computed(() => selected.value.size);

function isSelected(id: string): boolean {
  return selected.value.has(id);
}
function toggle(id: string): void {
  // Reassign for reactivity (a Set mutation is not tracked on its own).
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function selectAll(): void {
  selected.value = new Set(eligibleGaps.value.map((gap) => gap.id));
}
function clearSelection(): void {
  selected.value = new Set();
}

// Draft trigger (fire-once pending; the InterviewPrepSection precedent). A
// flagged/non-ok run returns 201 with plan:null — kept as a loud banner, not
// an error. A successful draft navigates to the new plan's detail page.
const drafting = ref(false);
const draftError = ref<string | null>(null);
const flaggedRun = ref<LearningPlanRun | null>(null);

async function draft(): Promise<void> {
  if (drafting.value || selectedCount.value === 0) return;
  draftError.value = null;
  flaggedRun.value = null;
  drafting.value = true;
  try {
    const result = await api.createLearningPlan({ gapIds: [...selected.value] });
    if (result.plan) {
      await navigateTo(`/learning-plans/${result.plan.id}`);
    } else {
      // 201 + plan:null = the run landed non-ok/flagged; no plan was written.
      flaggedRun.value = result.run;
    }
  } catch (cause) {
    draftError.value =
      cause instanceof ApiError ? cause.message : 'Drafting failed. Is the API running?';
  } finally {
    drafting.value = false;
  }
}
</script>

<template>
  <section v-if="data" data-testid="create-plan-section">
    <h2>Draft a learning plan</h2>
    <p class="cp-blurb">
      Pick the gaps to work on and draft a skill-growth plan over them — a set of learning foci you
      can turn into exercises and prove with evidence.
    </p>

    <p v-if="flaggedRun" class="cp-flagged" role="alert" data-testid="create-plan-flagged">
      The last drafting run did not produce a plan (status: {{ flaggedRun.status }}).
      <template v-if="flaggedRun.status === 'flagged'">
        The model cited a gap it was not given — it was rejected and the run flagged.
      </template>
      Drafting again is a fresh paid call.
    </p>

    <p v-if="report.reviewStatus !== 'reviewed'" data-testid="create-plan-review-gate">
      Review the fit report first — a learning plan drafts from its reviewed gaps.
    </p>
    <AppEmptyState v-else-if="eligibleGaps.length === 0" data-testid="create-plan-empty">
      No actionable gaps on this report — every requirement is already covered, so there is nothing
      to draft.
    </AppEmptyState>
    <template v-else>
      <div class="cp-controls">
        <button
          type="button"
          class="cp-select-control"
          data-testid="create-plan-select-all"
          @click="selectAll"
        >
          Select all
        </button>
        <button
          type="button"
          class="cp-select-control"
          data-testid="create-plan-clear"
          @click="clearSelection"
        >
          Clear
        </button>
      </div>
      <ul class="cp-gaps" data-testid="create-plan-gaps">
        <li v-for="gap in eligibleGaps" :key="gap.id" data-testid="create-plan-gap">
          <label class="cp-gap-label">
            <input
              type="checkbox"
              :checked="isSelected(gap.id)"
              data-testid="create-plan-checkbox"
              @change="toggle(gap.id)"
            />
            <span class="cp-gap-text">
              {{ gap.requirementText }}
              <span class="cp-chip">{{ gap.classification }}</span>
              <span class="cp-chip">{{ gap.requirementCategory }}</span>
            </span>
          </label>
        </li>
      </ul>

      <button
        type="button"
        class="cp-draft-button"
        :disabled="drafting || selectedCount === 0"
        data-testid="create-plan-submit"
        @click="draft"
      >
        {{
          drafting
            ? 'Drafting… (10–20 s, one paid call)'
            : `Draft learning plan from ${selectedCount} gap${selectedCount === 1 ? '' : 's'}`
        }}
      </button>
      <p v-if="drafting" role="status" data-testid="create-plan-pending">
        Drafting — typically 10–20 seconds. This fires once; leave it running.
      </p>
      <p v-if="draftError" role="alert" data-testid="create-plan-error">{{ draftError }}</p>
    </template>
  </section>
</template>

<style scoped>
.cp-blurb {
  color: var(--color-muted);
  margin: 0 0 0.6rem;
}
.cp-flagged {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger);
  padding: 0.5rem 0.75rem;
  font-weight: 600;
}
.cp-controls {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.cp-select-control {
  appearance: none;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.1rem 0.5rem;
  color: var(--color-link);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.cp-gaps {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.cp-gap-label {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  cursor: pointer;
}
.cp-gap-text {
  color: var(--color-text);
}
.cp-chip {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.cp-draft-button {
  margin-top: var(--space-1);
}
</style>
