# ADR-0022: Public demo deployment - AWS + Neon + Terraform

**Status:** Accepted | **Date:** 2026-08-02

Authored at M10-05 from the reserved stub (`RESERVED-public-demo-deployment.md`, reserved 2026-07-26
at M5-02, provider re-decided 2026-08-01). This ADR **discharges ADR-0015 trigger 3** (a role or
interview requesting a live platform demo, served by a separate instance seeded with fictional data
only) and revisits ADR-0007's at-rest question in that narrow, fictional-data context. It records a
decision whose implementation lands across M10-01..08; every implementation claim below cites the PR
that shipped it, and the forward-looking parts (Terraform, the deploy workflow, the uptime ping) are
named as the stories that own them.

## Context

ADR-0015 kept the platform local-first because it holds real private career data, and named the
reopening triggers. Trigger 3 - a live demo on fictional data - was scheduled as v2's M10 arc. The
demo is a **separate instance seeded with the fictional example profile only** (never `docs/profile/`),
so the privacy-decisive rejection of hosting *real* data is untouched; what M10 needs is a concrete,
costed, low-ops shape for that fictional-data instance, plus the demo-mode semantics that make a
public box safe (recorded separately in ADR-0023).

The provider was re-decided on 2026-08-01 (Carlos, PR #129, superseding ADR-0015's Azure Container
Apps amendment) after an operator-directed provider audit whose **primary criterion was hiring-manager
signal** for senior backend-leaning roles at product companies, cost and solo-ops fit secondary. The
audit's decisive findings: AWS carries the broadest hiring signal (Stack Overflow 2025 usage 43.3%
AWS vs 26.3% Azure vs 24.6% GCP; ~30% of US tech postings vs Azure's 24%, Azure demand clustering in
enterprise/public-sector); Terraform is the highest-resume-weight IaC skill (~70-75% of IaC-mentioning
DevOps postings) and transfers across clouds; Neon's serverless Postgres free tier plausibly runs the
demo database at $0/mo where AWS RDS has a ~$14/mo floor with no scale-to-zero. The workload (one OCI
container + Postgres 16) is substantially provider-interchangeable, so the choice buys brand signal
and a cost profile, not different engineering.

Two audit open items were verified firsthand on 2026-08-02 against official sources (AWS pricing pages,
the AWS Price List API, neon.com/docs) before this ADR was costed; the resolutions are recorded inline
below with their source URLs.

## Decision

Deploy the fictional-data demo as a **single same-origin container on AWS ECS Fargate**, fronted by an
**API Gateway HTTP API with a VPC Link** (no load balancer), backed by **Neon serverless Postgres**,
built as a **public GHCR image**, provisioned by **Terraform**, and deployed from CI via a **GitHub
OIDC federated role** with no long-lived cloud secret. **Region: us-east-2** (Carlos-ratified in-terminal
2026-08-02; matches the Neon project placement; the region choice does not move any cost below). The
running envelope is **~$13.26/mo** at 2026-08-02 prices.

### Compute - ECS Fargate, one task, 0.25 vCPU / 0.5 GB

One always-on Fargate task at 0.25 vCPU / 0.5 GB: **$0.04048/vCPU-hr + $0.004445/GB-hr** (us-east-2,
per-second billing, 1-minute minimum), desired-count 1 = 730 h/mo = **$9.01/mo compute**; there is no
scale-to-zero on Fargate. The container is the M10-02 same-origin image (`apps/api` serves both the
JSON API and the prebuilt SPA via `@fastify/static` behind `WEB_DIST_DIR`; PR #134), migrates then
boots as a non-root process, and structurally excludes `docs/`, `.env*`, and the Nitro server output.

- **AWS App Runner is rejected by elimination**: it is closed to new customers as of 2026-04-30
  ("will no longer be open to new customers starting April 30, 2026"), and Carlos's AWS account was
  created 2026-08-01 (a new customer). For the record it would have been ~$3.05/mo at this size, moot
  for a new account.
- **ECS Express Mode is rejected on cost**: it provisions an Application Load Balancer (~$16.43/mo +
  LCUs, more than the container itself) and its custom-domain support was unverified.

Sources: https://aws.amazon.com/fargate/pricing/ ,
https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-2/index.json ,
https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html

### Ingress - API Gateway HTTP API + VPC Link V2 + Cloud Map

A Fargate task's public IP changes every deploy and terminates TLS nowhere, so ingress is an **API
Gateway HTTP API + VPC Link V2 + Cloud Map** (populated by ECS Service Connect via DiscoverInstances) -
the official private-integration path with **no load balancer**. Fixed cost ~$0.10-0.60/mo (Cloud Map
instance + optional hosted zone) + $1 per million requests; TLS is a **free regional ACM certificate**
on the API custom domain; **demo.carlosgutz.com is a plain CNAME at the existing registrar - Route 53
is deliberately not used** (optional at every verified step).

Recorded HTTP API limits, none biting the demo: **30s hard integration timeout, 10MB payload, no
WebSockets/SSE**. Recorded operational trap: **a VPC link idle 60 days goes INACTIVE** (its ENIs are
reaped, requests fail, reprovisioning takes minutes) - the **M10-08 uptime ping is the standing
keep-alive**. Escape hatch, recorded not taken: an ALB (~$16.43/mo + LCU) if WebSockets, SSE, or
>30s requests are ever needed.

Sources: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/us-east-2/index.json ,
https://aws.amazon.com/elasticloadbalancing/pricing/

### Task networking - the egress nuance, recorded honestly

The task runs in a **public subnet with a public IPv4 ($0.005/hr = $3.65/mo) for EGRESS ONLY** (pulling
the GHCR image, reaching Neon). Its security group admits **only the VPC-link ENIs on the app port
(4301)** - no public ingress port is ever open. The private-subnet alternative would need a NAT gateway
(~$32/mo), rejected on cost.

### Database - Neon serverless Postgres 16, Free plan, aws-us-east-2

**Neon Free at $0/mo**: 100 CU-hr/mo (~400 h of 0.25-CU compute), autosuspend after a fixed 5-minute
idle, cold-start resume "within a few hundred milliseconds", us-east-2 supported. The **binding
constraint is the 0.5 GB storage cap** - overage suspends and fails writes but never deletes data; it
is the number watched at M10-08. Cheapest paid tier if the demo ever outgrows Free is Launch
(usage-based, no monthly minimum).

**Aurora Serverless v2 0-ACU auto-pause is rejected on latency class**: the pause is real and
$0-compute, but resume is ~15 seconds and 30+ seconds after >24 h paused - exactly a portfolio demo's
access pattern (the first recruiter click each day would stall half a minute). Kept as the named
fallback only.

Sources: https://neon.com/pricing , https://neon.com/docs/introduction/plans ,
https://neon.com/docs/introduction/scale-to-zero , https://neon.com/docs/introduction/regions ,
https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html

### Image, IaC, CI deploy

- **Image: public GHCR** (the audit's resume-signal finding; the image is fictional-data-capable only).
- **IaC: Terraform** (chosen over Bicep/CDK for cross-cloud transfer and resume weight; a public repo
  carries no secret values). The Terraform module + operator runbook land at **M10-06**.
- **CI deploy: a GitHub OIDC federated role** - no long-lived cloud secret stored in GitHub. The
  `deploy-demo.yml` workflow lands at **M10-07** (external-review class (a), failure path demonstrated).
- **Operator-local IAM**: a scoped `careerforge-ops` IAM user's keys are used for local Terraform only
  (root keys deleted, MFA on, 2026-08-01); IAM Identity Center is the recorded later upgrade path.

### Secrets - STOP-and-ask ceremony

Exactly **two real secrets** exist for the demo, both set manually by Carlos in **SSM Parameter Store**
per the M10-06 runbook (never in the repo, never in CI): `DATABASE_URL` (the Neon connection string)
and `AUTH_BOOTSTRAP_PASSWORD` (the published demo password per ADR-0023). **No `ANTHROPIC_API_KEY` ever
exists in the cloud** - the env layer fails closed if `DEMO_MODE=1` is set with a live key present
(shipped PR #135; see ADR-0023). This is the first-ever platform secret surface (ADR-0015 consequence 4,
CLAUDE.md hard rule), and it is deliberately as small as two fictional-data values.

### Ops posture

- **Reset is the backup**: a nightly EventBridge Scheduler job re-runs `demo:seed` (implementation at
  M10-06); there is no separate database backup because the seed *is* the source of truth.
- **CloudWatch log retention 14 days**; an **AWS Budgets alert** guards the envelope.
- **Cost envelope ~$13.26/mo** at 2026-08-02 prices: Fargate $9.01 + public IPv4 $3.65 + ingress
  ~$0.60 + Neon $0. Prices move; the date is stated with the figures so the decision record does not.

## Alternatives considered

| Option | Monthly | Why not |
| --- | --- | --- |
| **ECS Fargate + Neon Free (chosen)** | **~$13.26** | - |
| ECS Fargate + RDS t4g.micro | ~$32 | RDS has no scale-to-zero; ~$14/mo DB floor eats the envelope |
| AWS App Runner + Neon Free | ~$5-10 | closed to new customers 2026-04-30 |
| ECS Express Mode + Neon Free | ~$25-35 | provisions an ALB (~$16.43/mo); custom-domain unverified |
| Aurora Serverless v2 0-ACU | ~$1-4 DB | ~15-30s cold resume - wrong latency class for a demo |
| Azure ACA + Neon Free | ~$0 | weaker product-company brand signal (the re-decided-away option) |
| GCP Cloud Run + Neon Free | ~$0-2 | smallest job market signal |
| fly.io + Neon Free | ~$5 | no survey-measurable mindshare, no brand signal |

The cheaper container platforms (App Runner idle, ACA/Cloud Run scale-to-zero) were all real cost
wins; they lost to the hiring-signal criterion Carlos set as primary. The audit is explicit that the
providers are substantially interchangeable for this workload, so the ~$13/mo over a near-$0 option
buys AWS brand signal on the resume, nothing engineering.

## Consequences

- **Fictional data only on a hosted disk.** The deployed instance carries the example profile and the
  captured fictional postings (ADR-0023); ADR-0007's at-rest concern that kept the *real* store local
  does not apply here, and real private data stays permanently out of scope for this instance.
- **Two fictional-data secrets, no LLM key in the cloud.** The smallest defensible secret surface; the
  keyless posture is enforced at env parse, not just by omission (ADR-0023, PR #135).
- **No true scale-to-zero on compute.** ~$13/mo is always-on; the accepted cost of the brand-signal
  choice. The AWS Budgets alert and the 0.5 GB Neon cap are the guardrails.
- **A standing keep-alive obligation.** The 60-day VPC-link inactivity trap makes the M10-08 uptime
  ping load-bearing, not just nice-to-have.
- **The M1-02 runtime-config park is closed by the container shape.** Same-origin serving (SPA built
  with an empty API base, served by the API) means there is no separate web tier and no runtime base
  URL to inject; the park's disposition chain is PR #133 (build-time-inert probe record) -> PR #134
  (nuxt-generate + same-origin serve).
- **Numbering and immutability.** ADR-0015 stays untouched (append-only); its 2026-08-01 amendment
  already names this stub, and this authored ADR supersedes the stub by the recorded rename convention.

## Value

- **Product:** gives a hiring manager a live, honest, fictional-data instance of the platform to click
  through, at a defensible ~$13/mo, without exposing any real career data.
- **Skills:** a costed, source-cited cloud-architecture decision (Fargate vs App Runner vs Express Mode
  vs Aurora-v2; API Gateway private integration with no load balancer; Neon vs RDS) and an OIDC,
  no-stored-secret CI deploy - the container + Postgres + Terraform shape that reads as mainstream
  senior competence on any cloud.
- **Employability:** AWS + Terraform are the highest-signal line items for the target roles, and the
  record shows the judgment behind the spend (why AWS over cheaper equivalents, why keyless, why
  fictional-data-only) rather than just the plumbing.
