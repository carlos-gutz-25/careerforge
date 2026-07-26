# ADR-0015: Platform deployment — stay local-first, defer public hosting

**Status:** Accepted · **Date:** 2026-07-26

## Context

M4-03 asks for one decision, documented: where does the **platform** (the `apps/api` Fastify service, the `apps/web` platform UI, and its PostgreSQL database) run — stay local, Azure, or a PaaS — with cost and career rationale, *implementing only if the decision is trivial to execute inside the week*. This is distinct from ADR-0008, which governs the **portfolio** (`apps/portfolio`, a static SSG site) and is unchanged here.

The governing facts are already ratified elsewhere:

- **The platform holds real, private career data.** Resume detail, salary targets, job criteria, gap analyses, application history, and tailored resume variants are sensitive (RISKS §privacy; ADR-0007). "Local-only database" is an invariant, not a preference: `docs/profile/` is gitignored before the first commit, and every hosted surface to date (the portfolio) publishes only a deliberately curated, sensitivity-reviewed subset — never the private store.
- **Local-first is the stated platform posture** (PLAN §2.4): single-user (Carlos), real session auth, `user_id` on every table for later multi-user; "platform runs in Docker on Carlos's machine; only the portfolio is deployed publicly during the first 12 weeks."
- **The monolith rationale rejects operational sprawl** (ARCHITECTURE §1): a single senior engineer and a single user make distributed/managed complexity indefensible.
- **Any first-ever platform secret leaving `.env` for a hosted control plane is a STOP-and-ask** (CLAUDE.md hard rules; RISKS S-03). Today the platform has zero deploy secrets because it never deploys.

## Decision

**Stay local-first. Defer public platform deployment beyond the 12-week roadmap. Implement nothing now** — the deployment is not trivial-to-execute-within-the-week (each option below carries recurring cost, first-ever platform secrets, and/or a hosted copy of private data), so per the M4-03 acceptance criterion the decision is *recorded*, not *shipped*.

The platform continues to run via `docker compose up -d` + the local Node processes on Carlos's machine. This ADR is the deliverable.

## Alternatives considered — cost and career rationale

| Option | Recurring cost (single-user, always-on) | First-ever platform secrets | Real private data on a hosted disk? | Verdict |
| --- | --- | --- | --- | --- |
| **Stay local (Docker)** | **$0** | none | no | **Chosen** |
| Azure (App Service + Azure Database for PostgreSQL Flexible Server) | ~$25–40/mo floor (Burstable B1ms DB + a Basic/B1 plan), plus TLS, backups, a secret store, managed identity | yes (DB URL, `AUTH_BOOTSTRAP_PASSWORD`, `ANTHROPIC_API_KEY`) | yes, unless seeded example-only | Rejected for now |
| PaaS (Fly.io / Render / Railway class) | ~$10–20/mo (small always-on instance + managed Postgres; some free tiers sleep) | yes (same three) | yes, unless seeded example-only | Rejected for now |
| Self-managed VPS / container host | cheapest compute, highest ops burden (patching, backups, TLS renewal) for one user | yes | yes, unless seeded example-only | Rejected (indefensible ops-per-user) |

**Cost rationale.** Local is $0 and reuses the existing compose flow with zero new attack surface. Every hosted option is real recurring money for a tool used from one machine by one person, and the cheapest managed database is still an always-on cost. Azure buys the most enterprise-recognizable line item; a PaaS is faster to stand up and cheaper to enter; the VPS is cheapest to run and most expensive to operate. None clears the bar for an `S` story whose own acceptance criterion says *implement only if trivial*.

**Privacy rationale (decisive).** Every hosted option forces a fork: either put the **real** private career store on someone else's disk — a new, permanent exposure surface plus three first-ever platform secrets, against the local-only invariant — or stand up a hosted instance seeded with the fictional `docs/profile.example/` only, which Carlos would never use for his real search and which therefore exists purely as a demo. Neither is worth week-12 `S` effort.

**Career rationale.** The deployment competency a hiring manager can *see* is already shipped and live: ADR-0008's secretless, OIDC-based CI/CD deploy of the portfolio at carlosgutz.com. A deployed platform would add "I can run a Fastify+Postgres service on Azure/Fly," but the marginal signal is low against the cost and the privacy risk — and it is easily demonstrated later, in an example-data context, if a specific role asks. The stronger senior-engineering signal is the judgment on record here: *the platform is deliberately local-first because it holds real private data; here is the costed Azure-vs-PaaS trade-off and the exact conditions under which I would deploy it.* Privacy-by-design plus a documented trade-off beats an always-on demo nobody uses.

## Consequences

- **Strongest privacy/security posture retained:** no new secrets, no new hosted surface, $0 recurring — consistent with ADR-0007 and RISKS.
- **Single-machine platform, stated plainly:** no remote access (phone / second machine); the database is a local Docker named volume (`pgdata`); backup is Carlos's local responsibility and a machine loss loses local platform data unless separately backed up. An accepted local-first cost, recorded so it is not a surprise.
- **Named reopening triggers** — deployment is revisited when *any* fires:
  1. **A second real user (multi-user).** The schema already carries `user_id` (PLAN §2.4); real multi-user needs a hosted instance. Primary trigger; belongs to a v2 story (v2 candidates are recorded in M4-04).
  2. **A concrete remote-access need** (use the platform away from the dev machine).
  3. **A role/interview requesting a live platform demo** — served by a **separate hosted instance seeded with `docs/profile.example/` only**, never the real profile. A real-data deployment stays permanently out of scope unless the hosted-DB privacy story is solved first.
  4. **If deployment is ever done**, it is a new major technical choice → its **own ADR** (target platform, secret management, backup/restore, the real-vs-example-data decision), and the first-ever platform secret is a STOP-and-ask per CLAUDE.md.
- **Independent of the parked e2e question.** The M1-02 park carried under M4-03 — whether `NUXT_PUBLIC_*` runtime overrides inject into a prebuilt `ssr:false` payload, which would let the e2e web server move to build+preview — concerns e2e strategy, **not** platform hosting. It is untouched by this decision and stays parked.

## Value

- **Product:** the platform keeps its real private data local, the only posture the privacy invariant allows; the portfolio stays publicly deployed and unaffected.
- **Skills:** demonstrates a costed hosting trade-off (Azure vs PaaS vs VPS vs local), privacy-by-design deferral, and a decision recorded with explicit reopening triggers rather than reflexively shipped.
- **Employability:** a defensible, senior-level "why we did *not* deploy this yet" story, backed by an already-live secretless CI/CD deploy of the portfolio (ADR-0008) — judgment on display, not just plumbing.
