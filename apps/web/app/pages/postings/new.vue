<script setup lang="ts">
import { ApiError } from '../../utils/api-error.ts';

// Paste form (M1-02, kickoff pins):
//  1. DUMB PIPE — rawText is submitted exactly as it sits in the textarea:
//     no trim, no normalization, no client-side validation beyond the
//     browser's own; the server owns all semantics, so the UI path and the
//     curl path are interchangeable. (The browser itself normalizes textarea
//     newlines to LF per the HTML spec — platform-inherent, recorded
//     dismissal; dedupe-neutral via the server's hash normalization.)
//  2. The duplicate path renders the SERVER's boolean: duplicate:true
//     navigates to the STORED posting with the ?duplicate notice.
//  3. No client-side echo — after submit we navigate to the detail view and
//     render the GET response; textarea contents are never re-displayed as
//     saved content. Posting text has exactly one rendering path.
//  4. Errors display API messages as received (value-free by the API's
//     never-echo architecture); the client adds no preview of the paste.
const api = useApi();

const rawText = ref('');
const company = ref('');
const title = ref('');
const sourceNote = ref('');
const errorMessage = ref<string | null>(null);
const submitting = ref(false);

/** Metadata only (NEVER rawText): empty fields are omitted rather than sent
 *  as '' — the server nullifies either way, this just keeps the wire tidy. */
function optional(value: string): string | undefined {
  return value === '' ? undefined : value;
}

async function submit() {
  errorMessage.value = null;
  submitting.value = true;
  try {
    const { posting, duplicate } = await api.createPosting({
      rawText: rawText.value,
      company: optional(company.value),
      title: optional(title.value),
      sourceNote: optional(sourceNote.value),
    });
    await navigateTo(
      duplicate
        ? { path: `/postings/${posting.id}`, query: { duplicate: 'true' } }
        : `/postings/${posting.id}`,
    );
  } catch (cause) {
    errorMessage.value =
      cause instanceof ApiError ? cause.message : 'Paste failed. Is the API running?';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <h1>Paste a posting</h1>
    <form class="paste-form" @submit.prevent="submit">
      <label>
        Posting text
        <textarea
          v-model="rawText"
          name="rawText"
          rows="16"
          required
          placeholder="Paste the full job posting text here"
        ></textarea>
      </label>
      <label>
        Company <span class="paste-optional">(optional)</span>
        <input v-model="company" name="company" type="text" maxlength="200" />
      </label>
      <label>
        Title <span class="paste-optional">(optional)</span>
        <input v-model="title" name="title" type="text" maxlength="200" />
      </label>
      <label>
        Source note <span class="paste-optional">(optional)</span>
        <input v-model="sourceNote" name="sourceNote" type="text" maxlength="1000" />
      </label>
      <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      <button type="submit" :disabled="submitting">Save posting</button>
    </form>
  </div>
</template>

<style scoped>
.paste-form,
.paste-form label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 48rem;
}
.paste-form textarea {
  font-family: inherit;
}
.paste-optional {
  color: #888;
  font-weight: normal;
}
</style>
