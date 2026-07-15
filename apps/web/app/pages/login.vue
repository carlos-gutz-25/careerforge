<script setup lang="ts">
definePageMeta({ layout: false });

const route = useRoute();
const { login } = useAuth();

const email = ref('');
const password = ref('');
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
    </form>
  </main>
</template>

<style scoped>
.login {
  max-width: 20rem;
  margin: 15vh auto 0;
  font-family: system-ui, sans-serif;
}
.login form,
.login label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.login-error {
  color: #a4262c;
}
</style>
