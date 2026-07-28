<script setup lang="ts">
// Skill Signal group card (M9-03 UI). One recurrence group from the market
// signal (M9-02), rendered as EXPLAINABLE COUNTS ONLY - there is no composite
// "market score" anywhere on this card, by wire contract and by house law. Every
// number shown is a field the engine emitted; nothing is combined across groups.
//
// group.displayText / group.key / certification.matchedTerms are posting-derived
// and UNTRUSTED - rendered via {{ interpolation }} only (vue/no-v-html is a lint
// error). categories are a closed core enum (safe). refs are shown as a COUNT
// (the gap links are a future navigation surface); the raw ids never render.
//
// bestEvidenceWeight / meanEvidenceWeight are the scoring engine's own evidence
// currency (0..1), NOT a fit score and NOT a market score - labelled as such and
// shown verbatim (rounded for display only). reasonLabel is set only for the
// noAction section (still fully reported, D4).
import type { GapClassification, MarketSignalGroup } from '@careerforge/core';

defineProps<{ group: MarketSignalGroup; reasonLabel?: string | null }>();

// LOCAL typed display vocab (the skills-page / GapSection LADDER precedent): a
// `Record<GapClassification, string>` makes a new core classification a typecheck
// error here, and skill-signal.test.ts asserts every label renders (the runtime
// completeness pin). All five keys are always present on classificationCounts
// (honesty), so all five rows always render. TYPE-only core import (no value
// import) keeps core's zod out of the app bundle (the M1-11 zod-free-client law).
const CLASSIFICATION_LABELS: Record<GapClassification, string> = {
  have: 'Have',
  have_undemonstrated: 'Have, undemonstrated',
  needs_refresh: 'Needs refresh',
  genuine_gap: 'Genuine gap',
  low_priority: 'Low priority',
};

// Iterate the vocab's own keys (typed complete by the Record above) in the core
// enum's declared order - no value import of the enum array (bundle law).
const classificationOrder = Object.keys(CLASSIFICATION_LABELS) as GapClassification[];

// Display-only rounding of the engine's 0..1 evidence-weight currency. Not a
// recomputation - the emitted value verbatim, trimmed to two places to read.
function fmtWeight(value: number): string {
  return value.toFixed(2);
}
</script>

<template>
  <li class="sig-card" data-testid="signal-group-card">
    <div class="sig-head">
      <span class="sig-display" data-testid="group-display">{{ group.displayText }}</span>
      <AppStateChip
        v-if="group.certification.mentioned"
        variant="info"
        data-testid="group-certification-chip"
      >
        certification mentioned
      </AppStateChip>
      <AppStateChip v-if="reasonLabel" variant="neutral" data-testid="group-reason">
        {{ reasonLabel }}
      </AppStateChip>
    </div>

    <ul v-if="group.categories.length > 0" class="sig-categories" data-testid="group-categories">
      <li v-for="category in group.categories" :key="category" class="sig-category">
        {{ category }}
      </li>
    </ul>

    <!-- The explainable counts. Every value is emitted per group; none combined. -->
    <dl class="sig-counts" data-testid="group-counts">
      <div class="sig-count">
        <dt>Postings asking for it</dt>
        <dd>{{ group.postingCount }}</dd>
      </div>
      <div class="sig-count">
        <dt>Total mentions</dt>
        <dd>{{ group.instanceCount }}</dd>
      </div>
      <div class="sig-count">
        <dt>As a must-have</dt>
        <dd>{{ group.mustHavePostingCount }}</dd>
      </div>
      <div class="sig-count">
        <dt>As a nice-to-have</dt>
        <dd>{{ group.niceToHavePostingCount }}</dd>
      </div>
      <div class="sig-count">
        <dt>Excluded postings</dt>
        <dd>{{ group.excludedPostingCount }}</dd>
      </div>
    </dl>

    <p class="sig-weight" data-testid="group-evidence-weight">
      Your evidence weight (engine currency, 0-1):
      <span class="sig-weight-val">best {{ fmtWeight(group.bestEvidenceWeight) }}</span>
      <span class="sig-weight-val">mean {{ fmtWeight(group.meanEvidenceWeight) }}</span>
    </p>

    <div class="sig-classifications" data-testid="group-classifications">
      <p class="sig-sub">How your fit reports classify it</p>
      <ul class="sig-class-list">
        <li
          v-for="classification in classificationOrder"
          :key="classification"
          class="sig-class-row"
          data-testid="classification-row"
        >
          <span class="sig-class-label">{{ CLASSIFICATION_LABELS[classification] }}</span>
          <span class="sig-class-count">{{ group.classificationCounts[classification] }}</span>
        </li>
      </ul>
      <p v-if="group.overriddenCount > 0" class="sig-overridden" data-testid="group-overridden">
        {{ group.overriddenCount }} of these you classified yourself.
      </p>
    </div>

    <p v-if="group.certification.mentioned" class="sig-cert" data-testid="group-certification">
      Mentioned in {{ group.certification.postingCount }}
      {{ group.certification.postingCount === 1 ? 'posting' : 'postings'
      }}<template v-if="group.certification.matchedTerms.length > 0"
        >:
        <span class="sig-cert-terms">{{
          group.certification.matchedTerms.join(', ')
        }}</span></template
      >.
    </p>

    <p class="sig-refs" data-testid="group-refs">
      {{ group.refs.length }} linked {{ group.refs.length === 1 ? 'gap' : 'gaps' }} across your
      reports
    </p>
  </li>
</template>

<style scoped>
.sig-card {
  padding: var(--space-3);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.sig-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.sig-display {
  font-weight: 600;
}
.sig-categories,
.sig-class-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sig-categories {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-2);
}
.sig-category {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.sig-counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin: var(--space-3) 0 0;
}
.sig-count {
  display: flex;
  flex-direction: column;
}
.sig-count dt {
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.sig-count dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-lg);
}
.sig-weight {
  margin: var(--space-3) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.sig-weight-val {
  font-family: var(--font-mono);
  color: var(--color-accent);
  margin-left: var(--space-2);
}
.sig-classifications {
  margin-top: var(--space-3);
}
.sig-sub {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.sig-class-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
}
.sig-class-row {
  display: flex;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
}
.sig-class-label {
  color: var(--color-text);
}
.sig-class-count {
  font-family: var(--font-mono);
  color: var(--color-muted);
}
.sig-overridden {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.sig-cert {
  margin: var(--space-3) 0 0;
  font-size: var(--font-size-sm);
}
.sig-cert-terms {
  font-family: var(--font-mono);
}
.sig-refs {
  margin: var(--space-2) 0 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
</style>
