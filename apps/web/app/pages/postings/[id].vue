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
      <p v-if="transitionError" role="alert">{{ transitionError }}</p>
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
</style>
