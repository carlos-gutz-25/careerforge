# ADR-0007: Single-User Session Auth + Public-Repo Privacy Boundary

**Status:** Accepted (2026-07-13, with amendment) · **Date:** 2026-07-12

## Context

CareerForge has exactly one user, runs locally, and lives in a **public** repo — while processing the most personal data imaginable: career history, salary targets, gap analysis, application outcomes. Two intertwined decisions: how to authenticate, and how to keep private data out of a public codebase.

## Decision

### Auth: hand-rolled, minimal, real

- Session-based auth: HTTP-only, `SameSite=Lax`, signed cookies; sessions stored in Postgres; passwords hashed with argon2id; the single user is seeded from env at first boot (no registration flow).
- Rate limiting on `/auth/login`; session expiry + rotation on login; CSRF protection via same-site + origin checks on mutations.
- Every table carries `user_id` and repositories filter by it, so multi-user is a migration plus a registration flow — not a redesign.

#### Amendment (2026-07-13, ratified at M0-07 implementation)

- **"Signed" is satisfied by the token itself, not an HMAC.** The cookie value is a 256-bit CSPRNG capability whose only meaning is "look up SHA-256(value) in `sessions`". HMAC-signing defends guessable client-held claims; here a forger must guess 256 bits either way, so a signing secret adds no security while adding a key whose rotation would spuriously invalidate live sessions. No session-signing secret exists (RISKS S-03 inventory updated accordingly).
- **Tokens are hashed fast, passwords slow — deliberately.** argon2id defends low-entropy human secrets; a 256-bit random token is unguessable at any hash speed, and the deterministic SHA-256 digest is what makes the `token_hash` unique-index lookup possible.
- **Invariant: GET routes must never mutate state.** `SameSite=Lax` still sends cookies on cross-site top-level GET navigations; the CSRF posture (Lax + origin checks on mutating methods only) is sound only while GETs are side-effect-free.
- **`Secure` is production-only** (local dev is plain-HTTP 127.0.0.1); nothing is hosted until the M4-03 decision, and production implies HTTPS by policy.

### Privacy: the repo/data boundary

- **Public in the repo:** all code, all docs, ADRs, backlog, risks, and `docs/profile.example/` — a fully fictional but structurally identical profile used by tests, fixtures, and demo screenshots.
- **Private, never committed:** `docs/profile/` (real resume, projects, links, job criteria), `.env`, the local database, and any export containing real postings/applications. Enforced by `.gitignore` **written before the first commit**, a gitleaks pre-commit hook and CI scan, and a PII-review habit for screenshots/case-study content.
- **No PII in logs** (log convention reviewed in PRs); LLM calls send posting text and profile *summaries* as needed for drafting, but the improvement/learning drafting stage consumes structured, minimal data (ADR-0005), not whole documents.

## Alternatives Considered

- **No auth (it's localhost):** rejected — it forfeits the auth/session craft evidence (a named resume skill), and the moment the platform is hosted (M4 decision) it would be an emergency retrofit.
- **Auth.js / Lucia / Clerk:** fine products, but they outsource exactly the skill this project should demonstrate; OAuth adds a third-party dependency for a one-user system.
- **Private repo (privacy by obscurity):** rejected by explicit user decision — the public repo *is* the employability payoff; the example-profile pattern makes privacy a designed feature instead.
- **Encrypting profile data at rest:** disproportionate for a local single-user Postgres; revisit if the platform is ever hosted.

## Consequences

- A small amount of security-sensitive hand-rolled code — deliberately small (sessions table + argon2 + cookie handling), heavily tested, and itself portfolio material.
- The example-profile pattern doubles as a test-fixture strategy: all automated tests run against fictional data by construction.
- Discipline required: real data can never appear in committed fixtures, screenshots, or docs. The pre-commit scan and RISKS.md P-01 procedures back this up.

## Value

- **Product:** safe-by-default handling of the most sensitive data in the system; hosting later starts from a sane baseline.
- **Skills:** session management, password storage, CSRF/rate-limit hygiene — implemented, not just configured.
- **Employability:** "auth/session management" moves from resume keyword to reviewable public code, and the public-repo-with-private-data design is a strong privacy-engineering story.
