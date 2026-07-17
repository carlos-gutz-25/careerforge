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
// failure degrades to no section (like the applications probe); extraction
// itself is not triggered from this page yet (M1-10 owns that UX).
const { data: extraction } = useAsyncData(`posting-${postingId}-requirements`, () =>
  api.getPostingRequirements(postingId).catch(() => null),
);
const extractionRun = computed(() => extraction.value?.run ?? null);
const requirementRows = computed(() => extraction.value?.requirements ?? []);
const unverifiedCount = computed(
  () => requirementRows.value.filter((requirement) => requirement.quoteVerified === false).length,
);

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
      </div>
      <p v-if="trackError" role="alert">{{ trackError }}</p>
      <p v-if="transitionError" role="alert">{{ transitionError }}</p>
      <section v-if="extractionRun" data-testid="requirements-section">
        <h2>Extracted requirements</h2>
        <p
          v-if="extractionRun.status === 'flagged'"
          class="extraction-flagged"
          role="alert"
          data-testid="extraction-flagged"
        >
          {{ unverifiedCount }} of {{ requirementRows.length }} quotes could not be verified against
          the posting text — review before trusting this extraction.
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
        <p class="posting-meta" data-testid="extraction-telemetry">
          {{ extractionRun.model }} · {{ extractionRun.promptId }} ·
          {{ extractionRun.inputTokens }} in / {{ extractionRun.outputTokens }} out tokens ·
          {{ extractionRun.latencyMs }} ms · {{ extractionRun.status }} ·
          {{ new Date(extractionRun.createdAt).toLocaleString() }}
        </p>
      </section>
      <h2>Posting text</h2>
      <pre class="posting-raw" data-testid="posting-raw">{{ posting.rawText }}</pre>
    </template>
  </div>
</template>

<style scoped>
.posting-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
}
.posting-meta {
  color: #555;
}
.posting-duplicate {
  background: #fff8e1;
  border: 1px solid #e6d9a8;
  padding: 0.5rem 0.75rem;
}
.posting-raw {
  /* pre-wrap preserves the pasted newlines/indentation AND wraps long
     lines; the element stays a text-node renderer — no markup path. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  background: #fafafa;
  border: 1px solid #eee;
  padding: 0.75rem;
}
.extraction-flagged {
  /* Deliberately louder than the amber .posting-duplicate notice: a flagged
     run means unverified evidence — review before trusting. */
  background: #fdecea;
  border: 1px solid #c0392b;
  padding: 0.5rem 0.75rem;
  font-weight: 600;
}
.requirement-list {
  padding-left: 1.25rem;
}
.requirement-text {
  margin-bottom: 0.15rem;
}
.quote-unverified {
  background: #c0392b;
  color: #fff;
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  font-size: 0.85em;
  margin-left: 0.35rem;
}
.requirement-quote {
  /* Same rendering law as .posting-raw: text node + pre-wrap, no markup. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  background: #fafafa;
  border-left: 3px solid #ddd;
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.6rem;
  color: #444;
}
</style>
