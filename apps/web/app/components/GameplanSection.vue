<script setup lang="ts">
import type { FitReportResponse, GameplanChecklistItem, GameplanPhase } from '@careerforge/core';
import { ApiError } from '../utils/api-error.ts';

// Application gameplan section (M7-09 UI, ADR-0019). The third LLM-DRAFTED
// coaching artifact (alongside improvement plans and interview prep): given a
// scored fit report, a short strategy for pursuing THIS posting - one overall
// strategy summary, one strategy per active-pursuit phase (apply/screen/
// interview/offer), and 0..6 evidence-cited STAR stories. The ADR frames the
// one artifact as three views: Apply (the phase strategy), Speak (the STAR
// stories), Process (the deterministic checklist + the application-stage
// timeline). Rendering law (M1-02, same as rawText): {{ interpolation }} /
// <pre> ONLY - strategy/story text and the joined requirement/quote fields are
// LLM/posting-derived, all untrusted as markup (v-html is a lint ERROR
// repo-wide). Drafting is review-gated and fire-once (the paid call runs
// 10-20 s); an existing gameplan is served cached with no call (cache-once,
// ADR-0019 consequence B - regeneration is a re-score, never a redraft). The
// checklist toggle is the user's OWN deterministic process state (allowed
// pre-review, D6) and the server returns the FULL overlay so done is never
// computed client-side. No export - a gameplan is coaching, never a document.
const props = defineProps<{
  postingId: string;
  report: FitReportResponse;
  // The posting's tracked application (M1-03), or null when untracked. Passed
  // down so the Process view can link the stage timeline to the real tracker.
  trackedApplicationId?: string | null;
}>();

const api = useApi();

// Keyed by the report id so a re-score (new report) refetches: the gameplan is
// per-report and the workspace remounts this section on report change.
const { data, refresh } = useAsyncData(`gameplan-${props.report.id}`, () =>
  api.getGameplan(props.postingId).catch(() => null),
);

const gameplan = computed(() => data.value?.gameplan ?? null);
const run = computed(() => data.value?.run ?? null);

// A failed/flagged drafting run leaves a run with NO gameplan - the loud state.
// The GET run-selection contract returns the latest-by-time failure run only
// when gameplan is null, so this reads straight from the response.
const failedRun = computed(() =>
  gameplan.value === null && run.value !== null ? run.value : null,
);

// A Record keyed by the core union: TS rejects an incomplete map, so the phase
// vocabulary can never drift silently (the component test pins the rendered
// labels against GAMEPLAN_PHASES).
const phaseLabels: Record<GameplanPhase, string> = {
  apply: 'Apply',
  screen: 'Recruiter screen',
  interview: 'Interview',
  offer: 'Offer',
};

// The three ADR-0019 views. A local role=tablist with roving tabindex (the
// workspace-tabs pattern, scoped to this section).
const views = [
  { key: 'apply', label: 'Apply' },
  { key: 'speak', label: 'Speak' },
  { key: 'process', label: 'Process' },
] as const;
type ViewKey = (typeof views)[number]['key'];
const activeView = ref<ViewKey>('apply');
function onViewKeydown(event: KeyboardEvent, index: number) {
  const map: Record<string, number> = {
    ArrowLeft: (index - 1 + views.length) % views.length,
    ArrowRight: (index + 1) % views.length,
    Home: 0,
    End: views.length - 1,
  };
  const nextIndex = map[event.key];
  if (nextIndex === undefined) return;
  event.preventDefault();
  const next = views[nextIndex]!;
  activeView.value = next.key;
  document.getElementById(`gameplan-view-${next.key}`)?.focus();
}

// Checklist overlay: the server is authoritative (D6 - the UI never computes
// done client-side). It seeds from the gameplan's phase checklists on load; a
// toggle replaces it with the FULL overlay the POST returns. Reset to null on
// any refresh so the authoritative GET is re-read.
const localOverlay = ref<GameplanChecklistItem[] | null>(null);
const checklist = computed<GameplanChecklistItem[]>(
  () => localOverlay.value ?? gameplan.value?.phases.flatMap((phase) => phase.checklist) ?? [],
);
function checklistFor(phase: GameplanPhase): GameplanChecklistItem[] {
  return checklist.value.filter((item) => item.phase === phase);
}

const togglingKey = ref<string | null>(null);
const checkError = ref<string | null>(null);
async function toggleCheck(item: GameplanChecklistItem) {
  if (!gameplan.value || togglingKey.value) return;
  checkError.value = null;
  togglingKey.value = item.key;
  try {
    const result = await api.toggleGameplanCheck(gameplan.value.id, {
      checkKey: item.key,
      done: !item.done,
    });
    localOverlay.value = result.checklist;
  } catch (cause) {
    checkError.value =
      cause instanceof ApiError ? cause.message : 'Could not save that. Is the API running?';
  } finally {
    togglingKey.value = null;
  }
}

// Draft trigger (fire-once pending; the template gates on gameplan===null AND
// report.reviewStatus==='reviewed').
const drafting = ref(false);
const draftError = ref<string | null>(null);
async function draftGameplan() {
  if (drafting.value) return;
  draftError.value = null;
  drafting.value = true;
  try {
    await api.draftGameplan(props.postingId);
    localOverlay.value = null;
    await refresh();
  } catch (cause) {
    draftError.value =
      cause instanceof ApiError ? cause.message : 'Drafting failed. Is the API running?';
  } finally {
    drafting.value = false;
  }
}

// One-shot review (the plan/prep-section pattern).
const reviewNotes = ref('');
const reviewing = ref(false);
const reviewError = ref<string | null>(null);
async function markReviewed() {
  if (!gameplan.value || reviewing.value) return;
  reviewError.value = null;
  reviewing.value = true;
  try {
    await api.reviewGameplan(gameplan.value.id, {
      notes: reviewNotes.value ? reviewNotes.value : null,
    });
    localOverlay.value = null;
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
  <section v-if="data" data-testid="gameplan-section">
    <h2>Application gameplan</h2>
    <p class="gp-blurb">
      A strategy for pursuing this specific posting — how to approach each phase, the STAR stories
      your evidence supports, and a checklist to work through. Coaching, never a message to send.
    </p>

    <p v-if="failedRun" class="gp-failed" role="alert" data-testid="gp-failed-run">
      The last drafting run did not produce a gameplan (status: {{ failedRun.status }}).
      <template v-if="failedRun.status === 'flagged'">
        The model wrote something that read like a message to send, or cited evidence it was not
        given — it was rejected and the run flagged.
      </template>
      Drafting again is a fresh paid call.
    </p>

    <template v-if="gameplan === null">
      <p v-if="report.reviewStatus !== 'reviewed'" data-testid="gp-review-gate">
        Review the fit report first — the gameplan draws on the reviewed classifications and
        verified evidence.
      </p>
      <button
        v-else
        type="button"
        :disabled="drafting"
        data-testid="gp-draft-button"
        @click="draftGameplan"
      >
        {{ drafting ? 'Drafting… (10–20 s, one paid call)' : 'Draft application gameplan' }}
      </button>
      <p v-if="draftError" role="alert" data-testid="gp-draft-error">{{ draftError }}</p>
    </template>

    <template v-else>
      <p class="gp-meta" data-testid="gp-meta">
        <span
          v-if="gameplan.reviewStatus === 'draft'"
          class="gp-draft-chip"
          data-testid="gp-draft-chip"
        >
          draft — review before trusting it
        </span>
        <span v-else class="gp-reviewed-chip" data-testid="gp-reviewed-chip">Reviewed.</span>
      </p>

      <p class="gp-summary" data-testid="gp-strategy-summary">{{ gameplan.strategySummary }}</p>
      <pre v-if="gameplan.notes" class="gp-notes" data-testid="gp-notes">{{ gameplan.notes }}</pre>

      <!-- Meta-only sibling pointers (same fit report). No content, no invented
           routes — just which related coaching artifacts exist and their state. -->
      <p class="gp-siblings" data-testid="gp-siblings">
        Related for this report:
        <span class="gp-chip" data-testid="gp-sibling-improvement-plan">
          improvement plan —
          {{
            gameplan.siblings.improvementPlan
              ? gameplan.siblings.improvementPlan.reviewStatus
              : 'not drafted'
          }}
        </span>
        <span class="gp-chip" data-testid="gp-sibling-interview-prep">
          interview prep —
          {{
            gameplan.siblings.interviewPrep
              ? gameplan.siblings.interviewPrep.reviewStatus
              : 'not drafted'
          }}
        </span>
      </p>

      <!-- Three views (ADR-0019): Apply / Speak / Process. -->
      <div class="gp-views" role="tablist" aria-label="Gameplan views">
        <button
          v-for="(view, index) in views"
          :id="`gameplan-view-${view.key}`"
          :key="view.key"
          type="button"
          role="tab"
          class="gp-view-tab"
          :class="{ 'gp-view-tab--active': activeView === view.key }"
          :aria-selected="activeView === view.key"
          :aria-controls="`gameplan-panel-${view.key}`"
          :tabindex="activeView === view.key ? 0 : -1"
          :data-testid="`gp-view-${view.key}`"
          @click="activeView = view.key"
          @keydown="onViewKeydown($event, index)"
        >
          {{ view.label }}
        </button>
      </div>

      <!-- Apply: the overall + per-phase strategy. -->
      <div
        id="gameplan-panel-apply"
        role="tabpanel"
        aria-labelledby="gameplan-view-apply"
        tabindex="0"
        :hidden="activeView !== 'apply'"
        data-testid="gp-panel-apply"
      >
        <div
          v-for="phase in gameplan.phases"
          :key="phase.phase"
          class="gp-phase"
          data-testid="gp-phase-strategy"
        >
          <h3 class="gp-phase-name">{{ phaseLabels[phase.phase] }}</h3>
          <p class="gp-phase-text">{{ phase.strategy }}</p>
        </div>
      </div>

      <!-- Speak: the evidence-cited STAR stories. -->
      <div
        id="gameplan-panel-speak"
        role="tabpanel"
        aria-labelledby="gameplan-view-speak"
        tabindex="0"
        :hidden="activeView !== 'speak'"
        data-testid="gp-panel-speak"
      >
        <p v-if="gameplan.stories.length === 0" class="gp-empty" data-testid="gp-stories-empty">
          No stories in this gameplan — the model found no verified evidence strong enough to anchor
          one. That is honest, not a failure.
        </p>
        <ol v-else class="gp-stories">
          <li v-for="story in gameplan.stories" :key="story.id" data-testid="gp-story">
            <p class="gp-requirement" data-testid="gp-requirement">
              on: {{ story.requirementText }}
              <span class="gp-chip">{{
                story.requirementKind === 'must_have' ? 'must have' : 'nice to have'
              }}</span>
              <span class="gp-chip">{{ story.requirementCategory }}</span>
            </p>
            <dl class="gp-star">
              <dt>Situation</dt>
              <dd data-testid="gp-story-situation">{{ story.situation }}</dd>
              <dt>Task</dt>
              <dd data-testid="gp-story-task">{{ story.task }}</dd>
              <dt>Action</dt>
              <dd data-testid="gp-story-action">{{ story.action }}</dd>
              <dt>Result</dt>
              <dd data-testid="gp-story-result">{{ story.result }}</dd>
            </dl>
            <details v-if="story.citations.length > 0" data-testid="gp-story-citations">
              <summary>Cited evidence ({{ story.citations.length }})</summary>
              <div
                v-for="citation in story.citations"
                :key="citation.evidenceLinkId"
                class="gp-citation"
                data-testid="gp-story-citation"
              >
                <span class="gp-chip gp-evidence-chip" data-testid="gp-evidence-strength">{{
                  citation.strength
                }}</span>
                <p class="gp-quote-label">From the posting</p>
                <pre class="gp-quote" data-testid="gp-posting-quote">{{
                  citation.postingQuote
                }}</pre>
                <p class="gp-quote-label">From your profile</p>
                <pre class="gp-quote" data-testid="gp-profile-quote">{{
                  citation.profileQuote
                }}</pre>
              </div>
            </details>
          </li>
        </ol>
      </div>

      <!-- Process: the deterministic checklist + application-stage timeline. -->
      <div
        id="gameplan-panel-process"
        role="tabpanel"
        aria-labelledby="gameplan-view-process"
        tabindex="0"
        :hidden="activeView !== 'process'"
        data-testid="gp-panel-process"
      >
        <p v-if="checkError" role="alert" data-testid="gp-check-error">{{ checkError }}</p>
        <!-- Applications link card: the stage timeline below is the tracked
             application's own stage_change history (M1-03), so link to it. -->
        <div class="gp-application" data-testid="gp-application-card">
          <template v-if="trackedApplicationId">
            <NuxtLink
              :to="`/applications/${trackedApplicationId}`"
              class="gp-application-link"
              data-testid="gp-application-link"
            >
              Open this application in the tracker →
            </NuxtLink>
            <p class="gp-application-note">
              The stage timeline below reflects the changes you record there.
            </p>
          </template>
          <p v-else class="gp-application-note" data-testid="gp-application-untracked">
            Not tracking this application yet — start it in the Track tab to see stage changes here.
          </p>
        </div>
        <div v-for="phase in gameplan.phases" :key="phase.phase" class="gp-phase">
          <h3 class="gp-phase-name">{{ phaseLabels[phase.phase] }}</h3>
          <ul class="gp-checklist" data-testid="gp-checklist">
            <li v-for="item in checklistFor(phase.phase)" :key="item.key" data-testid="gp-check">
              <label class="gp-check-label">
                <input
                  type="checkbox"
                  :checked="item.done"
                  :disabled="togglingKey !== null"
                  data-testid="gp-check-input"
                  @change="toggleCheck(item)"
                />
                {{ item.label }}
              </label>
            </li>
          </ul>
          <ul
            v-if="phase.stageEvents.length > 0"
            class="gp-stage-events"
            data-testid="gp-stage-events"
          >
            <li
              v-for="(event, index) in phase.stageEvents"
              :key="`${event.occurredOn}-${index}`"
              class="gp-stage-event"
              data-testid="gp-stage-event"
            >
              {{ event.occurredOn }}: {{ event.fromStage }} → {{ event.toStage }}
            </li>
          </ul>
        </div>
      </div>

      <div v-if="gameplan.reviewStatus === 'draft'" class="gp-review" data-testid="gp-review-form">
        <textarea
          v-model="reviewNotes"
          :disabled="reviewing"
          placeholder="Review notes (optional)"
          data-testid="gp-review-notes"
        ></textarea>
        <button
          type="button"
          :disabled="reviewing"
          data-testid="gp-mark-reviewed"
          @click="markReviewed"
        >
          {{ reviewing ? 'Saving…' : 'Mark reviewed' }}
        </button>
        <p v-if="reviewError" role="alert" data-testid="gp-review-error">{{ reviewError }}</p>
      </div>
      <div v-else class="gp-reviewed" data-testid="gp-reviewed">
        <p v-if="gameplan.notes" class="gp-reviewed-note">Reviewed with notes above.</p>
        <p v-else class="gp-reviewed-note">Reviewed.</p>
      </div>
    </template>

    <!-- Run Evidence (M8-10 idiom): the drafting run's provenance, collapsed. -->
    <details v-if="run" class="gp-run-evidence" data-testid="gp-run-evidence">
      <summary class="gp-run-summary">Run evidence</summary>
      <p class="gp-telemetry" data-testid="gp-telemetry">
        {{ run.model }} · {{ run.promptId }} · {{ run.inputTokens }}/{{ run.outputTokens }} tok ·
        {{ run.latencyMs }} ms · {{ run.status }} · attempt {{ run.attempt }}
      </p>
    </details>
  </section>
</template>

<style scoped>
.gp-blurb {
  color: var(--color-muted);
  margin: 0 0 0.6rem;
}
.gp-failed {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger);
  padding: 0.5rem 0.75rem;
  font-weight: 600;
}
.gp-draft-chip {
  background: var(--color-draft-bg);
  border: 1px solid var(--color-accent);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.9em;
}
.gp-reviewed-chip {
  background: var(--color-reviewed-bg);
  border: 1px solid var(--color-reviewed);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.9em;
}
.gp-summary {
  color: var(--color-text);
  margin: 0 0 0.5rem;
}
.gp-siblings {
  margin: 0 0 0.6rem;
  color: var(--color-muted);
  font-size: 0.9em;
}
.gp-views {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 0.6rem;
}
.gp-view-tab {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  padding: 0.3rem 0.7rem;
  color: var(--color-muted);
  cursor: pointer;
}
.gp-view-tab--active {
  background: var(--color-panel);
  border-color: var(--color-border);
  color: var(--color-text);
  font-weight: 600;
}
.gp-phase {
  margin-bottom: 0.6rem;
}
.gp-phase-name {
  margin: 0 0 0.2rem;
  font-size: 1em;
}
.gp-phase-text {
  margin: 0;
  color: var(--color-text);
}
.gp-stories {
  padding-left: 1.25rem;
}
.gp-stories > li {
  margin-bottom: 0.75rem;
}
.gp-requirement {
  margin: 0 0 0.25rem;
  color: var(--color-muted);
  font-size: 0.9em;
}
.gp-star {
  margin: 0 0 0.3rem;
}
.gp-star dt {
  font-weight: 600;
  font-size: 0.85em;
  color: var(--color-muted);
}
.gp-star dd {
  margin: 0 0 0.3rem;
  color: var(--color-text);
}
.gp-chip {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.gp-evidence-chip {
  background: var(--color-info-bg);
  border-color: var(--color-info);
  margin-left: 0;
}
.gp-quote-label {
  margin: 0.25rem 0 0.1rem;
  color: var(--color-muted);
  font-size: 0.8em;
}
.gp-checklist {
  list-style: none;
  padding-left: 0;
  margin: 0 0 0.4rem;
}
.gp-check-label {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  color: var(--color-text);
}
.gp-stage-events {
  list-style: none;
  padding-left: 0;
  margin: 0;
}
.gp-stage-event {
  font-family: var(--font-mono);
  font-size: 0.85em;
  color: var(--color-muted);
}
.gp-empty {
  color: var(--color-muted);
}
.gp-application {
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  margin-bottom: 0.6rem;
}
.gp-application-note {
  margin: 0.15rem 0 0;
  color: var(--color-muted);
  font-size: 0.85em;
}
.gp-notes,
.gp-quote {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  background: var(--color-panel);
  border-left: 3px solid var(--color-border);
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.4rem;
  color: var(--color-text);
}
.gp-review textarea {
  display: block;
  width: 100%;
  max-width: 32rem;
  min-height: 4rem;
  margin-bottom: 0.4rem;
}
.gp-run-evidence {
  margin-top: 0.6rem;
  border-top: 1px solid var(--color-border);
  padding-top: 0.4rem;
}
.gp-run-summary {
  color: var(--color-muted);
  cursor: pointer;
}
.gp-telemetry {
  color: var(--color-muted);
  font-size: 0.85em;
}
</style>
