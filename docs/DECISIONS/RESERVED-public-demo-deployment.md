# ADR-RESERVED: Public demo deployment (Azure Container Apps)

**Status:** Reserved (stub) · **Number:** assigned at merge order (0016+) · **Reserved:** 2026-07-26 (M5-02)
**Owning story:** M10-05 (with M10-06 IaC). **Relationship:** discharges ADR-0015 trigger 3 and revisits ADR-0007's at-rest-encryption question (fictional data only).

## Why this stub exists

v2 ADR numbers are assigned at merge order (V2-PLAN section 6). This file reserves the decision by
name until its owning story lands, then it is renamed `00NN-public-demo-deployment.md` and authored in full.

## What it will record

- **Azure Container Apps** (~$12-15/mo), one container: Fastify serves the prebuilt SPA via
  `@fastify/static` behind optional `WEB_DIST_DIR`. Same-origin answers the M1-02 runtime-config
  park by design (verified by a probe story).
- **GHCR public image**, **Bicep** IaC (ACA env, PG Flexible B1ms, cron reset Job, Log Analytics,
  budget alert), GitHub Actions deploy via **OIDC federated credentials** (no stored cloud secret),
  ACA-native secrets with Key Vault as the named successor.
- **STOP-and-ask**: the two real secrets (`DATABASE_URL`, `AUTH_BOOTSTRAP_PASSWORD`) are set manually
  by Carlos per runbook; **no ANTHROPIC key ever exists in Azure**. Real data never on hosted disk;
  the deployed instance carries the fictional example profile only.
- Reseed-is-the-backup posture (nightly), cold-start disclosed on the login screen.

See docs/PLAN.md section 7 (v2 roadmap) and BACKLOG M10.
