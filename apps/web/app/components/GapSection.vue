<script setup lang="ts">
import type { GapClassification, GapResponse } from '@careerforge/core';
import { ApiError } from '../utils/api-error.ts';

// Gap classification section (M1-11). Rendering law (M1-02, same as
// rawText): {{ interpolation }} ONLY — requirementText/rationale are
// posting-derived and overrideNote is user text; all untrusted as markup
// (v-html is a lint ERROR repo-wide). Vocabulary law: these are
// CLASSIFICATIONS — "verdict" belongs to scored|excluded and never appears
// here. The section is report-scoped (the report being rendered); the host
// remounts it per report via :key.
const props = defineProps<{ reportId: string }>();

const api = useApi();

const { data, refresh } = useAsyncData(`fit-report-${props.reportId}-gaps`, () =>
  api.getFitReportGaps(props.reportId).catch(() => null),
);

// LADDER order for display grouping AND the override options (the
// classifier's precedence order, not the enum's ERD order). Deliberately a
// LOCAL typed list, not a runtime import of core's GAP_CLASSIFICATIONS: the
// web bundle imports core TYPES ONLY (the use-api law) — the one runtime
// value import this component briefly carried pulled zod into the client
// dep graph and vite's dev optimizer force-reloaded mid-navigation (the
// M1-11 e2e catch). The component test pins this list complete against
// core's enum, so it cannot drift silently.
const LADDER: GapClassification[] = [
  'have',
  'satisfied_fact',
  'have_undemonstrated',
  'needs_refresh',
  'low_priority',
  'genuine_gap',
  'unknown',
  'not_applicable',
];

const classificationLabels: Record<GapClassification, string> = {
  have: 'Have',
  have_undemonstrated: 'Have, but undemonstrated',
  needs_refresh: 'Needs refresh',
  genuine_gap: 'Genuine gap',
  low_priority: 'Low priority',
  // M12-02 evidence-status classes.
  satisfied_fact: 'Satisfied by a fact',
  unknown: 'Needs your input',
  not_applicable: 'Not applicable',
};

// D-2 resolution affordance (M12-02): a DETERMINISTIC "what would resolve this"
// line for `unknown` rows, templated from the engine's evaluator (no LLM), with
// a deep link to the surface that resolves it. Keyed by gap id so the template
// computes it once.
interface GapResolution {
  text: string;
  linkTo?: string;
  linkLabel?: string;
}
function resolutionFor(gap: GapResponse): GapResolution {
  switch (gap.evaluator) {
    case 'administrative_pattern':
      return {
        text: 'This looks like an administrative requirement (for example work authorization). Declaring durable profile facts to resolve these is coming soon.',
      };
    case 'seniority_threshold':
      return {
        text: 'No explicit years threshold was stated, so seniority could not be evaluated from a number here. Review the requirement on the posting.',
      };
    default:
      return {
        text: 'No profile evidence links to this requirement either way. Add it as a skill or attach mastery evidence to resolve it.',
        linkTo: '/skills',
        linkLabel: 'Go to Skills',
      };
  }
}
const resolutions = computed<Record<string, GapResolution>>(() => {
  const out: Record<string, GapResolution> = {};
  for (const gap of data.value?.gaps ?? []) {
    if (gap.classification === 'unknown') out[gap.id] = resolutionFor(gap);
  }
  return out;
});

const grouped = computed(() =>
  LADDER.map((classification) => ({
    classification,
    rows: (data.value?.gaps ?? []).filter((gap) => gap.classification === classification),
  })).filter((group) => group.rows.length > 0),
);

// Per-row override state (fire-once pending, the M1-10 trigger pattern).
const editingGapId = ref<string | null>(null);
const selectedClassification = ref<GapClassification | ''>('');
const noteDraft = ref('');
const saving = ref(false);
const overrideError = ref<string | null>(null);

function startOverride(gap: GapResponse) {
  overrideError.value = null;
  editingGapId.value = gap.id;
  selectedClassification.value = gap.classification;
  noteDraft.value = gap.overrideNote ?? '';
}

function cancelOverride() {
  editingGapId.value = null;
  overrideError.value = null;
}

async function submitOverride(classification: GapClassification | null) {
  if (!editingGapId.value) return;
  overrideError.value = null;
  saving.value = true;
  try {
    // A2 full replacement: the note we send REPLACES the stored one; a
    // revert sends classification null and no note.
    await api.overrideGap(
      editingGapId.value,
      classification === null
        ? { classification: null }
        : { classification, note: noteDraft.value ? noteDraft.value : null },
    );
    editingGapId.value = null;
    await refresh();
  } catch (cause) {
    overrideError.value =
      cause instanceof ApiError ? cause.message : 'Override failed. Is the API running?';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section v-if="data" data-testid="gap-section">
    <h2>Gap classifications</h2>
    <p
      v-if="data.lostOverrides > 0"
      class="gap-lost-overrides"
      role="alert"
      data-testid="gap-lost-overrides"
    >
      {{ data.lostOverrides }} override{{ data.lostOverrides === 1 ? '' : 's' }} from a previous
      extraction did not carry — review the classifications below.
    </p>

    <p v-if="data.gaps.length === 0" data-testid="gap-empty">
      No classified requirements on this report.
    </p>

    <div v-for="group in grouped" :key="group.classification" data-testid="gap-group">
      <h3>
        {{ classificationLabels[group.classification] }}
        <span class="gap-count">{{ group.rows.length }}</span>
      </h3>
      <ul class="gap-list">
        <li v-for="gap in group.rows" :key="gap.id" data-testid="gap-row">
          <p class="gap-requirement">
            {{ gap.requirementText }}
            <span class="gap-chip">{{ gap.requirementKind }}</span>
            <span class="gap-chip">{{ gap.requirementCategory }}</span>
            <span v-if="gap.userOverridden" class="gap-overridden" data-testid="gap-overridden">
              overridden{{ gap.carriedVia ? ' (carried)' : '' }}
            </span>
            <span
              v-if="gap.userOverridden && gap.classification !== gap.engineClassification"
              class="gap-disagrees"
              data-testid="gap-engine-disagrees"
            >
              engine says: {{ classificationLabels[gap.engineClassification] }}
            </span>
          </p>
          <p class="gap-rationale">{{ gap.rationale }}</p>
          <div v-if="resolutions[gap.id]" class="gap-resolution" data-testid="gap-resolution">
            <p class="gap-resolution-text">{{ resolutions[gap.id]!.text }}</p>
            <NuxtLink
              v-if="resolutions[gap.id]!.linkTo"
              :to="resolutions[gap.id]!.linkTo!"
              class="gap-resolution-link"
              data-testid="gap-resolution-link"
            >
              {{ resolutions[gap.id]!.linkLabel }}
            </NuxtLink>
          </div>
          <pre v-if="gap.overrideNote" class="gap-note" data-testid="gap-note">{{
            gap.overrideNote
          }}</pre>

          <div v-if="editingGapId === gap.id" class="gap-editor" data-testid="gap-editor">
            <label>
              Classification
              <select v-model="selectedClassification" :disabled="saving" data-testid="gap-select">
                <option v-for="value in LADDER" :key="value" :value="value">
                  {{ classificationLabels[value] }}
                </option>
              </select>
            </label>
            <input
              v-model="noteDraft"
              :disabled="saving"
              placeholder="Why (optional; replaces any stored note)"
              data-testid="gap-note-input"
            />
            <button
              type="button"
              :disabled="saving || selectedClassification === ''"
              data-testid="gap-save-override"
              @click="submitOverride(selectedClassification === '' ? null : selectedClassification)"
            >
              {{ saving ? 'Saving…' : 'Save override' }}
            </button>
            <button
              v-if="gap.userOverridden"
              type="button"
              :disabled="saving"
              data-testid="gap-revert"
              @click="submitOverride(null)"
            >
              Revert to engine
            </button>
            <button
              type="button"
              :disabled="saving"
              data-testid="gap-cancel"
              @click="cancelOverride"
            >
              Cancel
            </button>
            <p v-if="overrideError" role="alert" data-testid="gap-override-error">
              {{ overrideError }}
            </p>
          </div>
          <button
            v-else
            type="button"
            class="gap-override-button"
            data-testid="gap-override-button"
            @click="startOverride(gap)"
          >
            Override
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.gap-lost-overrides {
  /* The loud state (M1-06 precedent). */
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger);
  padding: 0.5rem 0.75rem;
  font-weight: 600;
}
.gap-count {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.8em;
  margin-left: 0.35rem;
}
.gap-list {
  padding-left: 1.25rem;
}
.gap-requirement {
  margin-bottom: 0.15rem;
}
.gap-chip {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.gap-overridden {
  background: var(--color-info-bg);
  color: var(--color-info);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.gap-disagrees {
  background: var(--color-draft-bg);
  border: 1px solid var(--color-accent);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.gap-rationale {
  margin: 0 0 0.4rem;
  color: var(--color-text);
}
.gap-note {
  /* Same rendering law as .fit-notes: text node + pre-wrap, no markup. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  background: var(--color-panel);
  border-left: 3px solid var(--color-border);
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.4rem;
  color: var(--color-text);
}
.gap-resolution {
  /* The "needs your input" affordance (M12-02 D-2). */
  background: var(--color-info-bg);
  border-left: 3px solid var(--color-info);
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.4rem;
}
.gap-resolution-text {
  margin: 0 0 0.25rem;
  color: var(--color-text);
}
.gap-editor select,
.gap-editor input {
  margin-right: 0.5rem;
}
.gap-editor button,
.gap-override-button {
  margin-right: 0.5rem;
}
</style>
