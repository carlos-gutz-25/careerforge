<script setup lang="ts">
const { user, logout } = useAuth();
</script>

<template>
  <div class="shell">
    <header class="shell-header">
      <strong>CareerForge</strong>
      <div class="shell-controls">
        <nav v-if="user">
          <NuxtLink to="/">Profile</NuxtLink>
          <NuxtLink to="/postings">Postings</NuxtLink>
          <NuxtLink to="/applications">Applications</NuxtLink>
          <span class="shell-user">{{ user.email }}</span>
          <button type="button" @click="logout">Log out</button>
        </nav>
        <AppThemeToggle />
      </div>
    </header>
    <main class="shell-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  max-width: 60rem;
  margin: 0 auto;
  padding: 1rem;
  font-family: system-ui, sans-serif;
}
.shell-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid #ccc;
  padding-bottom: 0.5rem;
}
.shell-user {
  margin-right: 0.75rem;
  color: #555;
}
.shell-controls {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}
nav a {
  margin-right: 0.75rem;
}
.shell-main {
  padding-top: 1rem;
}
</style>
