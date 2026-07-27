<script setup lang="ts">
import { ApiError } from '../../utils/api-error.ts';

// Posting detail (M1-02): the ONE place posting text is rendered, and it is
// UNTRUSTED (RISKS S-02, ADR-0006 layer 5). Rendering law:
//   - {{ interpolation }} ONLY — text lands in the DOM as a text node, so
//     an embedded <script>/<img onerror> payload is inert by construction
//     (v-html is a lint ERROR repo-wide; this page is why).
//   - Newlines/spacing survive via CSS `white-space: pre-wrap` on the <pre>
//     below — NEVER by converting \n to <br>, which requires v-html and is
//     the road back to XSS.
//
// M8-10 — Opportunity Workspace: the posting's lifecycle is presented as
// staged tabs (Capture -> Extract -> Score -> Gaps -> Prepare -> Track).
// Inactive panels stay in the DOM behind the `hidden` attribute (ARIA tab
// pattern), so every rendering-law contract and deep-linked state holds and
// the vitest/e2e testids remain reachable; Capture is the default so the
// posting text (`posting-raw`) is visible on first load. The staged UI adds no
// API calls and moves no existing testid — it only regroups the same surfaces.
const api = useApi();
const route = useRoute();
const postingId = String(route.params.id);

// 404 is translated to `null` in the fetcher (a missing posting is an
// expected state, not an exception) — useAsyncData wraps thrown errors in a
// NuxtError, so an instanceof check on error.value would be unreliable.
const {
  data: posting,
  status,
  error,
} = useAsyncData(`posting-${postingId}`, () =>
  api.getPosting(postingId).catch((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }),
);

// Tracked-state probe (M1-03): at most one application per posting ("tracked
// as" 0-or-1), fetched via the ?postingId= list filter — the posting
// contract itself stays untouched. Failure degrades to the Track button; a
// stale probe is harmless because create is duplicate-safe (200 + stored
// record), and both outcomes navigate to the same application.
const { data: trackedApplications } = useAsyncData(`posting-${postingId}-applications`, () =>
  api.listApplications({ postingId }).catch(() => null),
);
const trackedApplication = computed(() => trackedApplications.value?.applications[0] ?? null);

// Extraction results (M1-06): latest requirement-bearing run (ok or
// flagged). requirement text/sourceQuote are posting-DERIVED — the same
// rendering law as rawText applies (escaped interpolation only). Fetch
// failure degrades to no section (like the applications probe); the extract
// trigger below (M1-10) is this page's only way to start one.
const { data: extraction } = useAsyncData(`posting-${postingId}-requirements`, () =>
  api.getPostingRequirements(postingId).catch(() => null),
);
const extractionRun = computed(() => extraction.value?.run ?? null);
const requirementRows = computed(() => extraction.value?.requirements ?? []);
const unverifiedCount = computed(
  () => requirementRows.value.filter((requirement) => requirement.quoteVerified === false).length,
);

// Fit report (M1-10): the latest report or null. Fetch failure degrades to
// no section, like the probes above.
const { data: fit, refresh: refreshFit } = useAsyncData(`posting-${postingId}-fit`, () =>
  api.getPostingFit(postingId).catch(() => null),
);
const fitReport = computed(() => fit.value?.report ?? null);

// Extract trigger (M1-10 — the surface the M1-06 ledger assigned here). The
// call runs 10–20 s server-side and an aborted request does NOT stop the
// paid provider call — so the button disables and the page waits: fire once
// (the M1-05 friction disposition; this pending state is the designed fix).
const extracting = ref(false);
const extractError = ref<string | null>(null);

async function extractRequirements() {
  extractError.value = null;
  extracting.value = true;
  try {
    await api.extractPosting(postingId);
    // Server truth for both the new run and the status flip (new→extracted).
    await Promise.all([
      refreshNuxtData(`posting-${postingId}-requirements`),
      refreshNuxtData(`posting-${postingId}`),
    ]);
  } catch (cause) {
    extractError.value =
      cause instanceof ApiError ? cause.message : 'Extraction failed. Is the API running?';
  } finally {
    extracting.value = false;
  }
}

// Fit trigger: deterministic and LLM-free (fast), but the SAME pending
// treatment as extraction — one consistent trigger pattern.
const scoring = ref(false);
const scoreError = ref<string | null>(null);

async function scoreFit() {
  scoreError.value = null;
  scoring.value = true;
  try {
    await api.scorePostingFit(postingId);
    // Re-scoring appends; GET serves the latest. Status may flip → scored.
    await Promise.all([refreshFit(), refreshNuxtData(`posting-${postingId}`)]);
  } catch (cause) {
    scoreError.value =
      cause instanceof ApiError ? cause.message : 'Scoring failed. Is the API running?';
  } finally {
    scoring.value = false;
  }
}

const trackError = ref<string | null>(null);
const tracking = ref(false);

async function trackApplication() {
  trackError.value = null;
  tracking.value = true;
  try {
    const { application } = await api.createApplication({ postingId });
    // Created and already-tracked land on the same stored record.
    await navigateTo(`/applications/${application.id}`);
  } catch (cause) {
    trackError.value =
      cause instanceof ApiError ? cause.message : 'Could not track. Is the API running?';
  } finally {
    tracking.value = false;
  }
}

const transitionError = ref<string | null>(null);
const transitioning = ref(false);

async function setStatus(next: 'archived' | 'new') {
  transitionError.value = null;
  transitioning.value = true;
  try {
    const updated = await api.updatePostingStatus(postingId, { status: next });
    // Re-render from the SERVER response: metadata only — rawText keeps the
    // value already fetched by the one detail GET.
    if (posting.value) posting.value = { ...posting.value, ...updated };
  } catch (cause) {
    // API messages display as received (they are value-free by the API's
    // VALIDATION_ERROR architecture); the client adds no detail of its own.
    transitionError.value =
      cause instanceof ApiError ? cause.message : 'Status update failed. Is the API running?';
  } finally {
    transitioning.value = false;
  }
}

const notFound = computed(() => status.value === 'success' && posting.value === null);

// Staged tabs (M8-10). Order mirrors the opportunity lifecycle; Capture is the
// default so the posting text renders on first load (the e2e visibility
// contract). Each stage's content is the SAME surface as before — regrouped,
// never rewired.
const tabs = [
  { key: 'capture', label: 'Capture' },
  { key: 'extract', label: 'Extract' },
  { key: 'score', label: 'Score' },
  { key: 'gaps', label: 'Gaps' },
  { key: 'prepare', label: 'Prepare' },
  { key: 'track', label: 'Track' },
] as const;
type TabKey = (typeof tabs)[number]['key'];
const activeTab = ref<TabKey>('capture');

function selectTab(key: TabKey) {
  activeTab.value = key;
}

// Roving-tabindex keyboard nav across the tablist (WAI-ARIA tabs pattern):
// Arrow keys move + select, Home/End jump to the ends, focus follows.
function onTabKeydown(event: KeyboardEvent, index: number) {
  const map: Record<string, number> = {
    ArrowLeft: (index - 1 + tabs.length) % tabs.length,
    ArrowRight: (index + 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1,
  };
  const nextIndex = map[event.key];
  if (nextIndex === undefined) return;
  event.preventDefault();
  const next = tabs[nextIndex]!;
  activeTab.value = next.key;
  document.getElementById(`workspace-tab-${next.key}`)?.focus();
}
</script>

<template>
  <div>
    <p v-if="status === 'pending'">Loading posting…</p>
    <p v-else-if="notFound" role="alert">
      Posting not found. <NuxtLink to="/postings">Back to postings</NuxtLink>
    </p>
    <p v-else-if="error" role="alert">Could not load the posting: {{ error.message }}</p>
    <template v-else-if="posting">
      <p v-if="route.query.duplicate" class="posting-duplicate" role="status">
        This text was already pasted — showing the stored posting (its original metadata kept; the
        duplicate paste was discarded).
      </p>
      <div class="posting-head">
        <div>
          <h1>{{ posting.title ?? 'Untitled posting' }}</h1>
          <p class="posting-meta">
            {{ posting.company ?? 'Unknown company' }} · {{ posting.status }} · ingested
            {{ new Date(posting.createdAt).toLocaleDateString() }}
          </p>
          <p v-if="posting.sourceNote" class="posting-meta">{{ posting.sourceNote }}</p>
        </div>
      </div>

      <!-- Opportunity Workspace tabs (M8-10). role=tablist + roving tabindex;
           inactive panels carry the `hidden` attribute (in the DOM, not shown). -->
      <div class="workspace-tabs" role="tablist" aria-label="Opportunity workspace stages">
        <button
          v-for="(tab, index) in tabs"
          :id="`workspace-tab-${tab.key}`"
          :key="tab.key"
          type="button"
          role="tab"
          class="workspace-tab"
          :class="{ 'workspace-tab--active': activeTab === tab.key }"
          :aria-selected="activeTab === tab.key"
          :aria-controls="`workspace-panel-${tab.key}`"
          :tabindex="activeTab === tab.key ? 0 : -1"
          :data-testid="`workspace-tab-${tab.key}`"
          @click="selectTab(tab.key)"
          @keydown="onTabKeydown($event, index)"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Capture: the pasted posting text, rendered under the M1-02 law. -->
      <section
        id="workspace-panel-capture"
        role="tabpanel"
        aria-labelledby="workspace-tab-capture"
        tabindex="0"
        :hidden="activeTab !== 'capture'"
        data-testid="workspace-panel-capture"
      >
        <h2>Posting text</h2>
        <pre class="posting-raw" data-testid="posting-raw">{{ posting.rawText }}</pre>
      </section>

      <!-- Extract: requirement extraction (trigger or results) + Run Evidence. -->
      <section
        id="workspace-panel-extract"
        role="tabpanel"
        aria-labelledby="workspace-tab-extract"
        tabindex="0"
        :hidden="activeTab !== 'extract'"
        data-testid="workspace-panel-extract"
      >
        <div v-if="!extractionRun && posting.status !== 'archived'" data-testid="extract-trigger">
          <h2>Extracted requirements</h2>
          <p>No extraction yet.</p>
          <button
            type="button"
            data-testid="extract-button"
            :disabled="extracting"
            @click="extractRequirements"
          >
            {{ extracting ? 'Extracting…' : 'Extract requirements' }}
          </button>
          <p v-if="extracting" role="status" data-testid="extract-pending">
            Extracting — typically 10–20 seconds. This fires once; leave it running.
          </p>
          <p v-if="extractError" role="alert" data-testid="extract-error">{{ extractError }}</p>
        </div>
        <div v-if="extractionRun" data-testid="requirements-section">
          <h2>Extracted requirements</h2>
          <p
            v-if="extractionRun.status === 'flagged'"
            class="extraction-flagged"
            role="alert"
            data-testid="extraction-flagged"
          >
            {{ unverifiedCount }} of {{ requirementRows.length }} quotes could not be verified
            against the posting text — review before trusting this extraction.
          </p>
          <ol class="requirement-list">
            <li v-for="requirement in requirementRows" :key="requirement.id">
              <p class="requirement-text">
                {{ requirement.text }}
                <span class="posting-meta">
                  · {{ requirement.kind === 'must_have' ? 'must have' : 'nice to have' }} ·
                  {{ requirement.category }} · confidence {{ requirement.confidence }}
                </span>
                <span
                  v-if="requirement.quoteVerified === false"
                  class="quote-unverified"
                  data-testid="quote-unverified"
                >
                  unverified quote
                </span>
              </p>
              <pre class="requirement-quote">{{ requirement.sourceQuote }}</pre>
            </li>
          </ol>
          <!-- Run Evidence (M8-10): the LLM run's provenance, collapsed by
               default. Open it to audit which model/prompt produced this
               extraction and what it cost. -->
          <details class="run-evidence" data-testid="run-evidence">
            <summary class="run-evidence-summary">Run evidence</summary>
            <p class="posting-meta" data-testid="extraction-telemetry">
              {{ extractionRun.model }} · {{ extractionRun.promptId }} ·
              {{ extractionRun.inputTokens }} in / {{ extractionRun.outputTokens }} out tokens ·
              {{ extractionRun.latencyMs }} ms · {{ extractionRun.status }} ·
              {{ new Date(extractionRun.createdAt).toLocaleString() }}
            </p>
          </details>
        </div>
        <AppEmptyState v-if="!extractionRun && posting.status === 'archived'">
          This posting is archived — extraction is unavailable.
        </AppEmptyState>
      </section>

      <!-- Score: deterministic fit scoring trigger + the report. -->
      <section
        id="workspace-panel-score"
        role="tabpanel"
        aria-labelledby="workspace-tab-score"
        tabindex="0"
        :hidden="activeTab !== 'score'"
        data-testid="workspace-panel-score"
      >
        <div v-if="extractionRun && posting.status !== 'archived'" data-testid="fit-trigger">
          <button
            type="button"
            data-testid="score-fit-button"
            :disabled="scoring"
            @click="scoreFit"
          >
            {{ scoring ? 'Scoring…' : fitReport ? 'Re-score fit' : 'Score fit' }}
          </button>
          <p v-if="scoring" role="status">Scoring…</p>
          <p v-if="scoreError" role="alert" data-testid="score-fit-error">{{ scoreError }}</p>
        </div>
        <FitReportSection
          v-if="fitReport"
          :report="fitReport"
          :requirements="requirementRows"
          @reviewed="refreshFit()"
        />
        <AppEmptyState v-if="!fitReport && !(extractionRun && posting.status !== 'archived')">
          No fit report yet — extract requirements, then score to see the 7-dimension breakdown.
        </AppEmptyState>
      </section>

      <!-- Gaps: report-scoped gap set + improvement plan (both keyed to the
           report id so a re-score remounts them for the new report). -->
      <section
        id="workspace-panel-gaps"
        role="tabpanel"
        aria-labelledby="workspace-tab-gaps"
        tabindex="0"
        :hidden="activeTab !== 'gaps'"
        data-testid="workspace-panel-gaps"
      >
        <template v-if="fitReport">
          <GapSection :key="fitReport.id" :report-id="fitReport.id" />
          <ImprovementPlanSection
            :key="`plan-${fitReport.id}`"
            :report-id="fitReport.id"
            :report="fitReport"
          />
          <CreateLearningPlanSection
            :key="`create-plan-${fitReport.id}`"
            :report-id="fitReport.id"
            :report="fitReport"
          />
        </template>
        <AppEmptyState v-else>
          No gaps yet — score fit first; gaps and improvement plans are drawn from the fit report.
        </AppEmptyState>
      </section>

      <!-- Prepare: report-scoped resume variant (M2-10). Future prep surfaces
           (gameplan M7-09, interview prep M8-11) land inside this stage. -->
      <section
        id="workspace-panel-prepare"
        role="tabpanel"
        aria-labelledby="workspace-tab-prepare"
        tabindex="0"
        :hidden="activeTab !== 'prepare'"
        data-testid="workspace-panel-prepare"
      >
        <template v-if="fitReport">
          <ResumeVariantSection
            :key="`resume-${fitReport.id}`"
            :report-id="fitReport.id"
            :report="fitReport"
          />
          <InterviewPrepSection
            :key="`interview-${fitReport.id}`"
            :posting-id="postingId"
            :report="fitReport"
          />
        </template>
        <AppEmptyState v-else>
          Nothing to prepare yet — score fit first; tailoring and interview prep build on the fit
          report.
        </AppEmptyState>
      </section>

      <!-- Track: application tracking + the posting lifecycle (archive). -->
      <section
        id="workspace-panel-track"
        role="tabpanel"
        aria-labelledby="workspace-tab-track"
        tabindex="0"
        :hidden="activeTab !== 'track'"
        data-testid="workspace-panel-track"
      >
        <p v-if="trackError" role="alert">{{ trackError }}</p>
        <p v-if="transitionError" role="alert">{{ transitionError }}</p>
        <div class="posting-actions">
          <NuxtLink
            v-if="trackedApplication"
            :to="`/applications/${trackedApplication.id}`"
            data-testid="view-application"
          >
            View application
          </NuxtLink>
          <button
            v-else
            type="button"
            data-testid="track-application"
            :disabled="tracking"
            @click="trackApplication"
          >
            Track application
          </button>
          <button
            v-if="posting.status !== 'archived'"
            type="button"
            :disabled="transitioning"
            @click="setStatus('archived')"
          >
            Archive
          </button>
          <button v-else type="button" :disabled="transitioning" @click="setStatus('new')">
            Unarchive
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.posting-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
}
.posting-meta {
  color: var(--color-muted);
}
.posting-actions {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}
.posting-duplicate {
  background: var(--color-draft-bg);
  border: 1px solid var(--color-accent);
  padding: var(--space-2) var(--space-3);
}
.workspace-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  border-bottom: 1px solid var(--color-border);
  margin: var(--space-4) 0 var(--space-4);
}
.workspace-tab {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  padding: var(--space-2) var(--space-3);
  color: var(--color-muted);
  font: inherit;
  cursor: pointer;
  /* -1px so the active tab's bottom edge sits over the tablist border. */
  margin-bottom: -1px;
}
.workspace-tab:hover {
  color: var(--color-text);
}
.workspace-tab--active {
  color: var(--color-text);
  background: var(--color-panel);
  border-color: var(--color-border);
  border-bottom-color: var(--color-panel);
  font-weight: 600;
}
.workspace-tab:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
}
.run-evidence {
  margin-top: var(--space-3);
}
.run-evidence-summary {
  color: var(--color-muted);
  cursor: pointer;
}
.posting-raw {
  /* pre-wrap preserves the pasted newlines/indentation AND wraps long
     lines; the element stays a text-node renderer — no markup path. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  padding: var(--space-3);
}
.extraction-flagged {
  /* Deliberately louder than the amber .posting-duplicate notice: a flagged
     run means unverified evidence — review before trusting. */
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger);
  padding: var(--space-2) var(--space-3);
  font-weight: 600;
}
.requirement-list {
  padding-left: var(--space-4);
}
.requirement-text {
  margin-bottom: 0.15rem;
}
.quote-unverified {
  background: var(--color-danger-bg);
  color: var(--color-danger);
  border-radius: var(--radius-sm);
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.requirement-quote {
  /* Same rendering law as .posting-raw: text node + pre-wrap, no markup. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  background: var(--color-panel);
  border-left: 3px solid var(--color-border);
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.6rem;
  color: var(--color-text);
}
</style>
