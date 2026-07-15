/**
 * The auth guard (M0-10 acceptance criterion). Global on purpose: every
 * route is protected unless this middleware says otherwise — the same
 * default-deny posture as the API's root guard, mirrored client-side. The
 * session cookie is HttpOnly, so "am I logged in" is resolved by asking the
 * server (GET /auth/me) exactly once per app load; afterwards the state
 * lives in useSessionUser().
 *
 * - unauthenticated + protected route → /login?redirect=<target>
 * - authenticated + /login → / (nothing to do there)
 * - the redirect query is only consumed through safeRedirect() at login time
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, resolve } = useAuth();
  await resolve();
  const authenticated = user.value !== null && user.value !== undefined;

  if (to.path === '/login') {
    return authenticated ? navigateTo('/') : undefined;
  }
  if (!authenticated) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } });
  }
});
