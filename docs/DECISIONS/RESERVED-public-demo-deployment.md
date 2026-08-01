# ADR-RESERVED: Public demo deployment (AWS + Neon + Terraform)

**Status:** Reserved (stub) · **Number:** assigned at merge order (0016+) · **Reserved:** 2026-07-26 (M5-02) · **Provider re-decided:** 2026-08-01
**Owning story:** M10-05 (with M10-06 IaC). **Relationship:** discharges ADR-0015 trigger 3 and revisits ADR-0007's at-rest-encryption question (fictional data only).

## Why this stub exists

v2 ADR numbers are assigned at merge order (V2-PLAN section 6). This file reserves the decision by
name until its owning story lands, then it is renamed `00NN-public-demo-deployment.md` and authored in full.

## Provider re-decision (2026-08-01, Carlos)

Originally reserved as Azure Container Apps + Bicep (the ADR-0015 amendment path). Re-decided to
**AWS + Neon + Terraform** after an operator-directed provider audit (deep research, adversarially
verified; hiring-manager signal as the primary criterion per Carlos's direction, cost and solo-ops
fit secondary). Decisive findings: AWS carries the broadest hiring signal for senior backend roles
at product companies (SO 2025 usage 43.3% vs 26.3%/24.6%; ~30% of US tech postings vs Azure's 24%,
with Azure demand clustered in enterprise/public-sector); Terraform is the IaC skill with the most
resume weight (~70-75% of IaC-mentioning DevOps postings) and transfers across clouds; Neon's
serverless Postgres free tier plausibly runs the demo database at $0/mo where AWS RDS has a ~$14/mo
floor with no scale-to-zero. The workload (one OCI container + Postgres 16) is substantially
provider-interchangeable, so the choice buys brand signal and a cost profile, not different
engineering. ADR-0015's second amendment records the same re-decision from the v1 side.

## What it will record

- **AWS compute** for one container: Fastify serves the prebuilt SPA via `@fastify/static` behind
  optional `WEB_DIST_DIR`. Same-origin answers the M1-02 runtime-config park by design (verified by
  a probe story). Final service (App Runner vs ECS Fargate) is picked at M10-05 after verifying App
  Runner idle pricing firsthand - Fargate's always-on floor is ~$18/mo, the audit's one unverified
  AWS leg.
- **Neon serverless Postgres 16** (free tier at demo scale: autosuspend when idle, $0 suspended;
  usage-based with no monthly minimum beyond it). Terms re-confirmed at build time.
- **GHCR public image**, **Terraform** IaC (chosen over Bicep/CDK for cross-cloud transferability
  and resume signal), GitHub Actions deploy via **OIDC federated credentials** (no stored cloud
  secret), nightly reset via a scheduled job (service named at M10-05), log retention + budget alert.
- **STOP-and-ask**: the two real secrets (`DATABASE_URL` - now the Neon connection string - and
  `AUTH_BOOTSTRAP_PASSWORD`) are set manually by Carlos per runbook; **no ANTHROPIC key ever exists
  in the cloud**. Real data never on hosted disk; the deployed instance carries the fictional
  example profile only.
- Reseed-is-the-backup posture (nightly), cold-start disclosed on the login screen.

See docs/PLAN.md section 7 (v2 roadmap) and BACKLOG M10.
