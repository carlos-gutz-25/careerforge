<template>
  <!-- Skip link is the FIRST focusable element; it targets <main id="main">. -->
  <a class="skip-link" href="#main">Skip to main content</a>
  <header>
    <!-- Site name is a LINK, not a heading (D1): the template owns the single
         <h1>, which lives in the page. -->
    <NuxtLink to="/">CareerForge</NuxtLink>
    <nav aria-label="Main">
      <NuxtLink to="/">Home</NuxtLink>
      <NuxtLink to="/#case-studies-heading">Case studies</NuxtLink>
    </nav>
  </header>
  <main id="main" tabindex="-1">
    <slot />
  </main>
  <footer>
    <p>CareerForge — career development platform.</p>
  </footer>
  <!-- Announces SPA route changes to assistive tech (built into Nuxt 4). -->
  <NuxtRouteAnnouncer />
</template>
