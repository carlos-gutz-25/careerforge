<script setup lang="ts">
// M8-25 - document titles and the html lang attribute.
//
// WHY THIS EXISTS: the M8-22 host Lighthouse run measured `document-title`,
// `html-has-lang` and `meta-description` failing on every route (accessibility
// 0.79, seo 0.73 on home). `html-has-lang` is the one that actually harms a
// person: with no lang, a screen reader announces English content using whatever
// voice the user's system defaults to. The title matters for orientation - every
// tab in a multi-tab session read "Nuxt app" or nothing at all.
//
// WHY A CENTRAL MAP instead of a `useHead` in each of the 16 pages: one surface
// to review, one place where the naming stays consistent, and it can be pinned by
// a test against the pages directory so a NEW page cannot silently ship untitled.
// Sixteen scattered calls could each drift on their own.
//
// The lang attribute itself is set in nuxt.config (app.head.htmlAttrs) because it
// is static; only the title needs to react to the route.
const route = useRoute();

const APP_NAME = 'CareerForge';

// Keyed by Nuxt's generated route name. Values are the human name of the screen,
// not the route path - this is what a person sees in a tab.
const ROUTE_TITLES: Record<string, string> = {
  index: 'Command Center',
  login: 'Log in',
  evidence: 'Evidence Library',
  'skill-signal': 'Skill Signal',
  postings: 'Postings',
  'postings-new': 'Save a posting',
  'postings-id': 'Opportunity Workspace',
  applications: 'Applications',
  'applications-id': 'Application',
  'case-studies': 'Case studies',
  'case-studies-id': 'Case study',
  criteria: 'Criteria',
  'learning-plans': 'Learning plans',
  'learning-plans-id': 'Learning plan',
  'review-queue': 'Review queue',
  skills: 'Skills',
};

// Never render a blank or a placeholder title. An unmapped route falls back to the
// app name alone, which is honest and orienting rather than wrong - the same
// principle as the M15-06 run-status fallback: say what is known, invent nothing.
const title = computed(() => {
  const name = typeof route.name === 'string' ? route.name : '';
  const screen = ROUTE_TITLES[name];
  return screen ? `${screen} - ${APP_NAME}` : APP_NAME;
});

useHead({ title });
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
