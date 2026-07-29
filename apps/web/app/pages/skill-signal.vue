<script setup lang="ts">
// Skill Signal (M9-03 UI) - the read surface for the market-signal aggregation
// (M9-02, GET /market-signal). Deterministic and LLM-free (the review-queue /
// skill-upgrades projection class): recurrence arithmetic over the caller's OWN
// saved postings, recomputed on every GET. It groups the skills your postings
// keep asking for into four action buckets - Sharpen / Prove / Build / Certify -
// each explained ENTIRELY by emitted counts. There is no composite "market
// score" anywhere: the wire forbids one and so does this page (the
// never-one-merged-score lineage).
//
// HONESTY: report.honesty is the claim ceiling (recurrence over your own saved
// postings, never a market prediction) and is rendered VERBATIM on-surface.
// COHORT (D5): every posting the signal did and did NOT draw from is disclosed,
// counted, never silent. An EMPTY cohort is a valid report - the honesty string
// and the cohort disclosure still render; only the buckets fall back to an empty
// state. Group displayText / matchedTerms are posting-derived and UNTRUSTED -
// rendered via {{ interpolation }} only (see SkillSignalGroupCard).
import type {
  MarketSignalBuckets,
  MarketSignalCohort,
  MarketSignalNoActionReason,
} from '@careerforge/core';

// LOCAL typed display vocab (the skills-page LADDER precedent), each pinned
// complete by skill-signal.test.ts against its core enum / schema:
//  - BUCKET_META keys are exactly the four MarketSignalBuckets keys; a renamed
//    bucket is a typecheck error here and the test asserts four sections render.
const BUCKET_META: Record<keyof MarketSignalBuckets, { title: string; blurb: string }> = {
  sharpen: {
    title: 'Sharpen',
    blurb: 'Skills you already have that keep coming up - keep them sharp and current.',
  },
  prove: {
    title: 'Prove',
    blurb: 'Skills you have but have not demonstrated - turn them into evidence.',
  },
  build: {
    title: 'Build',
    blurb: 'Recurring gaps worth closing - learn them and build something that shows it.',
  },
  certify: {
    title: 'Certify',
    blurb: 'Skills where postings mention a certification - weigh whether one is worth it.',
  },
};
const BUCKET_ORDER: (keyof MarketSignalBuckets)[] = ['sharpen', 'prove', 'build', 'certify'];

//  - NO_ACTION_LABELS keys are exactly the noAction reasons; a new reason is
//    a typecheck error and the test asserts each label renders.
const NO_ACTION_LABELS: Record<MarketSignalNoActionReason, string> = {
  covered_or_low_priority: 'Covered or low priority',
  all_postings_excluded: 'Every asking posting is excluded',
  // M12-02: nothing actionable, but at least one requirement's evidence is
  // unknown - surfaced for resolution, never silently "covered".
  needs_input: 'Needs your input',
};

//  - COHORT_LABELS keys are exactly the MarketSignalCohort keys; the panel
//    iterates the keys the SERVER actually sent (never a hard-coded subset), so
//    a new cohort field surfaces automatically and the Record guarantees a label.
const COHORT_LABELS: Record<keyof MarketSignalCohort, string> = {
  postingsConsidered: 'Postings considered',
  postingsWithSignal: 'Postings contributing a signal',
  postingsWithoutReport: 'Postings without a fit report',
  postingsArchived: 'Archived postings',
  excludedVerdictPostings: 'Postings excluded by verdict',
  draftReports: 'Draft fit reports',
  reviewedReports: 'Reviewed fit reports',
  unscoredRequirementsInCohort: 'Requirements not yet scored',
};

const api = useApi();
const { data, status, error } = useAsyncData('market-signal', () => api.getMarketSignal());

// Empty by the RENDERED arrays, not by groupCount alone - robust to how the
// engine counts noAction. No buckets and no noAction groups => the empty state.
const isEmpty = computed(() => {
  const report = data.value;
  if (!report) return false;
  const bucketed = BUCKET_ORDER.reduce((n, key) => n + report.buckets[key].length, 0);
  return bucketed === 0 && report.noAction.length === 0;
});

const cohortKeys = computed(() =>
  data.value ? (Object.keys(data.value.cohort) as (keyof MarketSignalCohort)[]) : [],
);
</script>

<template>
  <div>
    <h1>Skill signal</h1>
    <p class="ss-blurb">
      The skills your saved postings keep asking for, grouped into what to sharpen, prove, build,
      and certify. Every number below is a plain count from your own postings and fit reports -
      there is no single overall score.
    </p>

    <AppSkeleton v-if="status === 'pending'" :lines="6" />
    <p v-else-if="error" role="alert" data-testid="skill-signal-error">
      Could not load your skill signal: {{ error.message }}
    </p>

    <template v-else-if="data">
      <!-- Honesty ceiling, VERBATIM. -->
      <AppPanel tone="quote" class="ss-honesty">
        <p class="ss-honesty-text" data-testid="skill-signal-honesty">{{ data.honesty }}</p>
        <p class="ss-scorer" data-testid="skill-signal-scorer">scorer v{{ data.scorerVersion }}</p>
      </AppPanel>

      <!-- Cohort disclosure (D5): every posting drawn-from and NOT, counted. -->
      <section
        class="ss-cohort"
        aria-labelledby="ss-cohort-heading"
        data-testid="skill-signal-cohort"
      >
        <h2 id="ss-cohort-heading" class="ss-cohort-heading">What this signal is drawn from</h2>
        <dl class="ss-cohort-grid">
          <div
            v-for="key in cohortKeys"
            :key="key"
            class="ss-cohort-item"
            data-testid="cohort-item"
          >
            <dt>{{ COHORT_LABELS[key] }}</dt>
            <dd>{{ data.cohort[key] }}</dd>
          </div>
        </dl>
      </section>

      <AppEmptyState v-if="isEmpty" data-testid="skill-signal-empty">
        No skill signal yet. Once your saved postings have scored fit reports, the skills they keep
        asking for will appear here, grouped into what to sharpen, prove, build, and certify.
      </AppEmptyState>

      <template v-else>
        <section
          v-for="bucket in BUCKET_ORDER"
          :key="bucket"
          class="ss-bucket"
          :aria-labelledby="`bucket-${bucket}-heading`"
          :data-testid="`bucket-${bucket}`"
        >
          <h2 :id="`bucket-${bucket}-heading`">{{ BUCKET_META[bucket].title }}</h2>
          <p class="ss-bucket-blurb">{{ BUCKET_META[bucket].blurb }}</p>
          <p
            v-if="data.buckets[bucket].length === 0"
            class="ss-bucket-empty"
            data-testid="bucket-empty"
          >
            Nothing in this bucket right now.
          </p>
          <ul v-else class="ss-group-list" :data-testid="`bucket-${bucket}-groups`">
            <SkillSignalGroupCard
              v-for="group in data.buckets[bucket]"
              :key="group.key"
              :group="group"
            />
          </ul>
        </section>

        <section
          v-if="data.noAction.length > 0"
          class="ss-bucket"
          aria-labelledby="ss-no-action-heading"
          data-testid="no-action-section"
        >
          <h2 id="ss-no-action-heading">Not actionable right now</h2>
          <p class="ss-bucket-blurb">
            Recurring skills the signal found but is not asking you to act on - still fully
            reported, with why.
          </p>
          <ul class="ss-group-list" data-testid="no-action-groups">
            <SkillSignalGroupCard
              v-for="group in data.noAction"
              :key="group.key"
              :group="group"
              :reason-label="NO_ACTION_LABELS[group.reason]"
            />
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.ss-blurb {
  color: var(--color-muted);
  margin: 0 0 var(--space-4);
  max-width: 44rem;
}
.ss-honesty {
  margin-bottom: var(--space-4);
}
.ss-honesty-text {
  margin: 0;
}
.ss-scorer {
  margin: var(--space-2) 0 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.ss-cohort {
  margin-bottom: var(--space-6);
}
.ss-cohort-heading {
  font-size: var(--font-size-lg);
}
.ss-cohort-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: var(--space-2) 0 0;
}
.ss-cohort-item {
  display: flex;
  flex-direction: column;
}
.ss-cohort-item dt {
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.ss-cohort-item dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-lg);
}
.ss-bucket {
  margin-top: var(--space-6);
}
.ss-bucket-blurb {
  color: var(--color-muted);
  margin: 0 0 var(--space-3);
  max-width: 44rem;
}
.ss-bucket-empty {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.ss-group-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
