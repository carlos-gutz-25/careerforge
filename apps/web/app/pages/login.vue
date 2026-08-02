<script setup lang="ts">
definePageMeta({ layout: false });

const route = useRoute();
const { login } = useAuth();
// M10-04, D3: on a demo instance the login prefills the canonical PUBLISHED
// demo credentials so the visitor can sign in immediately. Init-time only
// (v-model owns the refs after) - the flag is resolved before this page renders
// by auth.global.ts. Non-demo instances leave the refs empty (zero change).
const { demo } = useDemoMode();

const email = ref(demo.value ? DEMO_EMAIL : '');
const password = ref(demo.value ? DEMO_PASSWORD : '');
const errorMessage = ref<string | null>(null);
const submitting = ref(false);

async function submit() {
  errorMessage.value = null;
  submitting.value = true;
  try {
    await login({ email: email.value, password: password.value });
    // ?redirect= is user-influenceable input: only internal paths survive
    // safeRedirect(); anything absolute/protocol-relative lands on '/'.
    await navigateTo(safeRedirect(route.query.redirect));
  } catch (error) {
    if (error instanceof ApiError) {
      errorMessage.value =
        error.status === 401
          ? 'Invalid email or password.'
          : error.status === 429
            ? 'Too many attempts — wait a few minutes and try again.'
            : 'Login failed. Is the API running?';
      return;
    }
    errorMessage.value = 'Login failed. Is the API running?';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <!-- Second demo-banner mount: the login page opts out of the layout
         (layout: false), so it carries its own copy of the shell banner. -->
    <AppBanner v-if="demo" tone="info">{{ DEMO_BANNER_TEXT }}</AppBanner>
    <main class="login">
      <h1>CareerForge</h1>
      <form @submit.prevent="submit">
        <label>
          Email
          <input v-model="email" type="email" name="email" autocomplete="username" required />
        </label>
        <label>
          Password
          <input
            v-model="password"
            type="password"
            name="password"
            autocomplete="current-password"
            required
          />
        </label>
        <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>
        <button type="submit" :disabled="submitting">Log in</button>
        <p v-if="demo" class="login-demo-hint">Sign in with the prefilled demo credentials.</p>
      </form>
    </main>
  </div>
</template>

<style scoped>
.login {
  max-width: 20rem;
  margin: 15vh auto 0;
  font-family: var(--font-ui);
}
.login form,
.login label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.login-error {
  color: var(--color-danger);
}
.login-demo-hint {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
</style>
