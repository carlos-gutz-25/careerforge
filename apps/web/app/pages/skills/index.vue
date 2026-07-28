<script setup lang="ts">
// Skills & upgrades (M3-06 UI, M8-15). Two deterministic, LLM-free projections
// (the review-queue / criteria-suggestions class):
//
//  1. SUGGESTIONS (GET /skill-upgrade-suggestions) — completed, fully-evidenced
//     exercises whose evidence would earn a profile skill a `solid` grant.
//     Recomputed on every GET (nothing stored, nothing stale). Confirming an
//     upgrade sends ONLY the two ids; the server re-derives the whole grant from
//     the exercise + profile state (zero client trust), so the button is a pure
//     affordance. Any one backing exercise earns the grant, so Confirm is offered
//     per backing exercise — the user picks which evidence anchors it.
//
//  2. GRANTS AUDIT (GET /skill-upgrades) — ALL grants, active + revoked, with the
//     evidence trail and a derived `detached` flag (an active grant whose skill
//     name no longer exists in the profile — a markdown rename is delete+insert
//     under full-sync, so the honest signal is to revoke or re-earn). Revoke is
//     the correction recourse (effective level falls back to declared —
//     append-only, never a delete); an optional note records why.
//
// After either action both lists re-fetch: a confirmed skill leaves suggestions
// and appears in the audit; a revoked grant flips status and its skill may
// resurface as a suggestion. Skill / requirement / exercise / artifact text are
// all user/posting-derived and UNTRUSTED — rendered via {{ interpolation }} only
// (vue/no-v-html is a lint error), and artifactUrl is escaped TEXT, never an
// <a href> (S-02). Levels, ids and dates are evidence surfaces (mono).
import type {
  EvidenceKind,
  SkillLevel,
  SkillUpgrade,
  SkillUpgradeSuggestion,
  SkillUpgradeSuggestionExercise,
  UpgradeStatus,
} from '@careerforge/core';

// LOCAL typed display vocab (the use-api law / GapSection LADDER precedent): the
// page owns its vocab; a `Record<Enum, …>` makes a new core enum member a
// typecheck error here, and skills-upgrades.test.ts pins each map's keys against
// the core enum array so the completeness is also asserted at runtime.
const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  expert: 'Expert',
  solid: 'Solid',
  rusty: 'Rusty',
  learning: 'Learning',
};
const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  implemented: 'Implemented',
  tested: 'Tested',
  explained: 'Explained',
  revisited: 'Revisited',
};
// active grants read as achieved (green); revoked ones are neutral history.
const UPGRADE_STATUS_CHIP: Record<UpgradeStatus, 'reviewed' | 'neutral'> = {
  active: 'reviewed',
  revoked: 'neutral',
};

const api = useApi();
const {
  data: suggestionsData,
  status: suggestionsStatus,
  error: suggestionsError,
  refresh: refreshSuggestions,
} = useAsyncData('skill-upgrade-suggestions', () => api.getSkillUpgradeSuggestions());
const {
  data: grantsData,
  status: grantsStatus,
  error: grantsError,
  refresh: refreshGrants,
} = useAsyncData('skill-upgrades', () => api.listSkillUpgrades());

// One in-flight action at a time, keyed by exerciseId (confirm) or grantId
// (revoke) — both are uuids, so a single busy key disables every action button
// while one runs (the review-queue precedent). A confirmed/revoked action
// re-fetches BOTH projections, since either can move a suggestion or a grant.
const busyId = ref<string | null>(null);
const actionError = ref<string | null>(null);
// Per-active-grant optional revoke note; empty/whitespace sends null (the wire
// note is `.trim().min(1)`, so '' is unrepresentable — it must be null, not '').
const revokeNotes = reactive<Record<string, string>>({});

async function refreshBoth(): Promise<void> {
  await Promise.all([refreshSuggestions(), refreshGrants()]);
}

async function confirmUpgrade(
  suggestion: SkillUpgradeSuggestion,
  exercise: SkillUpgradeSuggestionExercise,
): Promise<void> {
  if (busyId.value) return;
  busyId.value = exercise.exerciseId;
  actionError.value = null;
  try {
    await api.createSkillUpgrade({
      profileSkillId: suggestion.profileSkillId,
      exerciseId: exercise.exerciseId,
    });
    await refreshBoth();
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Could not confirm the upgrade.';
  } finally {
    busyId.value = null;
  }
}

async function revokeGrant(grant: SkillUpgrade): Promise<void> {
  if (busyId.value) return;
  busyId.value = grant.id;
  actionError.value = null;
  const note = revokeNotes[grant.id]?.trim();
  try {
    await api.revokeSkillUpgrade(grant.id, { note: note ? note : null });
    delete revokeNotes[grant.id];
    await refreshBoth();
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Could not revoke the grant.';
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <div>
    <h1>Skills &amp; upgrades</h1>
    <p class="sk-blurb">
      Completed exercises with full mastery evidence can earn a profile skill a higher effective
      level. Confirm a suggested upgrade to record it, or revoke a past grant to correct it — your
      declared level always stands underneath.
    </p>

    <p v-if="actionError" role="alert" class="sk-action-error" data-testid="skill-action-error">
      {{ actionError }}
    </p>

    <section class="sk-section" aria-labelledby="sk-suggestions-heading">
      <h2 id="sk-suggestions-heading">Suggested upgrades</h2>
      <AppSkeleton v-if="suggestionsStatus === 'pending'" :lines="4" />
      <p v-else-if="suggestionsError" role="alert">
        Could not load upgrade suggestions: {{ suggestionsError.message }}
      </p>
      <template v-else-if="suggestionsData">
        <AppEmptyState v-if="suggestionsData.suggestions.length === 0">
          No upgrades suggested right now. Complete an exercise with implemented and tested evidence
          and, if it backs one of your skills, it will appear here.
        </AppEmptyState>
        <ul v-else class="sk-list" data-testid="skill-suggestions">
          <li
            v-for="suggestion in suggestionsData.suggestions"
            :key="suggestion.profileSkillId"
            class="sk-suggestion"
            data-testid="skill-suggestion-row"
          >
            <div class="sk-suggestion-head">
              <span class="sk-skill-name">{{ suggestion.skillName }}</span>
              <span class="sk-level" data-testid="suggestion-level">
                {{ SKILL_LEVEL_LABELS[suggestion.currentLevel] }}
                <span aria-hidden="true">&rarr;</span>
                {{ SKILL_LEVEL_LABELS[suggestion.suggestedLevel] }}
              </span>
            </div>
            <p class="sk-hint">
              Backed by {{ suggestion.exercises.length }} completed
              {{ suggestion.exercises.length === 1 ? 'exercise' : 'exercises' }}. Confirm from any
              one to record the upgrade.
            </p>
            <ul class="sk-exercise-list">
              <li
                v-for="exercise in suggestion.exercises"
                :key="exercise.exerciseId"
                class="sk-exercise"
                data-testid="suggestion-exercise-row"
              >
                <div class="sk-exercise-main">
                  <span class="sk-exercise-title">{{ exercise.title }}</span>
                  <span class="sk-exercise-meta"
                    >completed <time>{{ exercise.completedOn }}</time></span
                  >
                </div>
                <ul
                  v-if="exercise.matchedRequirements.length > 0"
                  class="sk-req-list"
                  data-testid="suggestion-requirements"
                >
                  <li
                    v-for="req in exercise.matchedRequirements"
                    :key="req.requirementId"
                    class="sk-req"
                  >
                    {{ req.text }}
                  </li>
                </ul>
                <button
                  type="button"
                  class="sk-confirm"
                  data-testid="confirm-upgrade"
                  :disabled="busyId !== null"
                  @click="confirmUpgrade(suggestion, exercise)"
                >
                  {{ busyId === exercise.exerciseId ? 'Confirming…' : 'Confirm upgrade' }}
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </template>
    </section>

    <section class="sk-section" aria-labelledby="sk-grants-heading">
      <h2 id="sk-grants-heading">Upgrade history</h2>
      <AppSkeleton v-if="grantsStatus === 'pending'" :lines="4" />
      <p v-else-if="grantsError" role="alert">
        Could not load upgrade history: {{ grantsError.message }}
      </p>
      <template v-else-if="grantsData">
        <AppEmptyState v-if="grantsData.upgrades.length === 0">
          No upgrades yet. Confirmed upgrades and any you later revoke are recorded here with their
          evidence trail.
        </AppEmptyState>
        <ul v-else class="sk-list" data-testid="skill-grants">
          <li
            v-for="grant in grantsData.upgrades"
            :key="grant.id"
            class="sk-grant"
            data-testid="skill-grant-row"
          >
            <div class="sk-grant-head">
              <span class="sk-skill-name">{{ grant.skillName }}</span>
              <span class="sk-level" data-testid="grant-level">
                {{ SKILL_LEVEL_LABELS[grant.fromLevel] }}
                <span aria-hidden="true">&rarr;</span>
                {{ SKILL_LEVEL_LABELS[grant.toLevel] }}
              </span>
              <AppStateChip :variant="UPGRADE_STATUS_CHIP[grant.status]" data-testid="grant-status">
                {{ grant.status }}
              </AppStateChip>
              <AppStateChip v-if="grant.detached" variant="danger" data-testid="grant-detached">
                detached
              </AppStateChip>
            </div>
            <p class="sk-grant-meta">
              <span
                >from <span class="sk-exercise-title">{{ grant.exerciseTitle }}</span></span
              >
              <span class="sk-grant-date"
                >granted <time>{{ grant.createdAt }}</time></span
              >
              <span v-if="grant.status === 'revoked' && grant.revokedAt" class="sk-grant-date"
                >revoked <time>{{ grant.revokedAt }}</time></span
              >
            </p>
            <p v-if="grant.revokeNote" class="sk-revoke-note" data-testid="grant-revoke-note">
              {{ grant.revokeNote }}
            </p>
            <ul
              v-if="grant.evidence.length > 0"
              class="sk-evidence-list"
              data-testid="grant-evidence"
            >
              <li
                v-for="(ev, i) in grant.evidence"
                :key="i"
                class="sk-evidence"
                data-testid="grant-evidence-row"
              >
                <span class="sk-evidence-kind">{{ EVIDENCE_KIND_LABELS[ev.kind] }}</span>
                <time class="sk-evidence-date">{{ ev.recordedOn }}</time>
                <span v-if="ev.artifactUrl" class="sk-evidence-url">{{ ev.artifactUrl }}</span>
              </li>
            </ul>
            <div v-if="grant.status === 'active'" class="sk-revoke">
              <input
                v-model="revokeNotes[grant.id]"
                type="text"
                class="sk-revoke-input"
                data-testid="revoke-note"
                placeholder="Reason (optional)"
                :disabled="busyId !== null"
                :aria-label="`Reason for revoking the ${grant.skillName} upgrade`"
              />
              <button
                type="button"
                class="sk-revoke-btn"
                data-testid="revoke-grant"
                :disabled="busyId !== null"
                @click="revokeGrant(grant)"
              >
                {{ busyId === grant.id ? 'Revoking…' : 'Revoke' }}
              </button>
            </div>
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.sk-blurb {
  color: var(--color-muted);
  margin: 0 0 var(--space-4);
  max-width: 40rem;
}
.sk-action-error {
  color: var(--color-danger);
  margin: 0 0 var(--space-3);
}
.sk-section {
  margin-top: var(--space-6);
}
.sk-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.sk-suggestion,
.sk-grant {
  padding: var(--space-3);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.sk-suggestion-head,
.sk-grant-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.sk-skill-name {
  font-weight: 600;
}
.sk-level {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-accent);
}
.sk-hint {
  margin: var(--space-2) 0 0;
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.sk-exercise-list,
.sk-req-list,
.sk-evidence-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sk-exercise-list {
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.sk-exercise {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.sk-exercise-main {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.sk-exercise-title {
  font-weight: 600;
}
.sk-exercise-meta,
.sk-grant-meta,
.sk-grant-date {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.sk-req-list {
  margin-top: var(--space-1);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.sk-req::before {
  content: '· ';
}
.sk-confirm {
  margin-top: var(--space-2);
}
.sk-grant-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: var(--space-2) 0 0;
}
.sk-revoke-note {
  margin: var(--space-2) 0 0;
  color: var(--color-muted);
  font-style: italic;
}
.sk-evidence-list {
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}
.sk-evidence {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  color: var(--color-muted);
}
.sk-evidence-kind {
  color: var(--color-text);
}
.sk-evidence-url {
  word-break: break-all;
}
.sk-revoke {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
  margin-top: var(--space-3);
}
.sk-revoke-input {
  flex: 1;
  min-width: 12rem;
}
</style>
