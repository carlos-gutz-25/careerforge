<script setup lang="ts">
const { user, logout } = useAuth();
</script>

<template>
  <div class="shell" :class="{ 'shell--auth': user }">
    <!--
      Authenticated: Dusk Console sidebar. The four sections are the v2
      information architecture (Search/Growth/Publish/Profile). Growth and
      Publish have no pages yet (they land in M8-11+), so they render as muted
      "Coming soon" placeholders rather than dead links. The Postings link keeps
      its exact accessible name - e2e/postings-xss.spec.ts pins it.
    -->
    <aside v-if="user" class="shell-sidebar">
      <strong class="shell-brand">CareerForge</strong>
      <nav class="shell-nav" aria-label="Primary">
        <div class="nav-section">
          <p class="nav-section-title">Search</p>
          <NuxtLink to="/postings">Postings</NuxtLink>
          <NuxtLink to="/applications">Applications</NuxtLink>
          <NuxtLink to="/criteria">Search criteria</NuxtLink>
        </div>
        <div class="nav-section">
          <p class="nav-section-title">Growth</p>
          <span class="nav-soon">Coming soon</span>
        </div>
        <div class="nav-section">
          <p class="nav-section-title">Publish</p>
          <span class="nav-soon">Coming soon</span>
        </div>
        <div class="nav-section">
          <p class="nav-section-title">Profile</p>
          <NuxtLink to="/">Overview</NuxtLink>
        </div>
      </nav>
      <div class="shell-account">
        <span class="shell-user">{{ user.email }}</span>
        <button type="button" @click="logout">Log out</button>
        <AppThemeToggle />
      </div>
    </aside>

    <!-- Unauthenticated (login): brand + theme toggle only, no nav. -->
    <div v-else class="shell-topbar">
      <strong class="shell-brand">CareerForge</strong>
      <AppThemeToggle />
    </div>

    <main class="shell-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  font-family: var(--font-ui);
}
.shell--auth {
  display: flex;
  align-items: stretch;
  min-height: 100vh;
}

.shell-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  flex-shrink: 0;
  width: 15rem;
  padding: var(--space-4);
  border-right: 1px solid var(--color-border);
}
.shell-brand {
  font-size: var(--font-size-lg);
}

.shell-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.nav-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.nav-section-title {
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-muted);
}
.shell-nav a {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  text-decoration: none;
  transition: background-color var(--transition-fast);
}
.shell-nav a:hover {
  background: var(--color-panel);
}
.shell-nav a.router-link-active {
  color: var(--color-link);
  background: var(--color-panel);
}
.nav-soon {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}

.shell-account {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: auto;
}
.shell-user {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
  word-break: break-all;
}

.shell-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.shell-main {
  flex: 1;
  min-width: 0;
  max-width: 60rem;
  padding: var(--space-6);
}

@media (max-width: 40rem) {
  .shell--auth {
    flex-direction: column;
  }
  .shell-sidebar {
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }
  .shell-account {
    margin-top: var(--space-4);
  }
}
</style>
