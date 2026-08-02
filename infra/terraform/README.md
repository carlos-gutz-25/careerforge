# CareerForge public demo - Terraform

Infrastructure-as-code for the fictional-data public demo. This module codes the
shape decided in **docs/DECISIONS/0022-public-demo-deployment.md** (AWS + Neon +
Terraform, us-east-2, ~$13.26/mo) with the demo-mode semantics of
**docs/DECISIONS/0023-demo-mode-semantics.md**. The operator runbook (the
STOP-and-ask secret ceremony and first manual apply) is
**docs/runbooks/demo-deploy.md**.

This module is **validated, not applied, in the repo** (M10-06). The first
`terraform apply` is operator-attended per the runbook (M10-08 owns go-live); the
gap between "validate clean" and "applies clean" is honest and closed there.

## What it provisions

- **ECS Fargate** one always-on service (0.25 vCPU / 0.5 GB) running the shipped
  same-origin image (API + prebuilt SPA), in a **public subnet with a public IP
  for egress only** (GHCR pull + Neon); the security group opens **no public
  ingress port**.
- **API Gateway HTTP API + VPC Link V2 + Cloud Map** for stable HTTPS with **no
  load balancer**; a free regional **ACM cert**; `demo.carlosgutz.com` via a plain
  registrar CNAME (Route 53 not used).
- **Two SSM SecureString secrets**, referenced by name (see "Secrets" below).
- **CloudWatch** log group (14-day retention).
- **EventBridge Scheduler** nightly run of the **dedicated seed task definition**.
- **AWS Budgets** monthly alert.
- **GitHub OIDC** provider + a minimal deploy role (dormant until M10-07's
  `deploy-demo.yml` consumes it).

## Secrets never enter Terraform (D4)

The two real secrets - `DATABASE_URL` (the Neon connection string) and
`AUTH_BOOTSTRAP_PASSWORD` - are **pre-existing SSM SecureString parameters created
by the operator** (runbook step 2). Terraform references them **by name** and
builds the parameter ARN for the task's `secrets` block, so **no secret value ever
appears in Terraform code, variables, outputs, or state**. This is why local state
(below) is acceptable in a public-repo project: state carries no secret. There is
**no `ANTHROPIC_API_KEY`** anywhere - a demo is keyless, and the app's env layer
refuses to boot if a key is present with `DEMO_MODE=1` (ADR-0023).

## Task-definition ownership (the deploy/apply split)

The demo has two ECS task definitions with **different owners**, so an operator
`terraform apply` and the M10-07 deploy workflow do not fight:

- **Server task definition** - `aws_ecs_service.server` sets
  `lifecycle { ignore_changes = [task_definition] }`. After the first apply, the
  **M10-07 workflow** registers new server revisions (new image tags) and rolls
  the service to them; Terraform will not roll it back to its pinned revision.
- **Seed task definition** - stays **Terraform-owned** (not ignored). It is run by
  the nightly scheduler, not the service.

Consequence, by design: a **migration-bearing deploy** advances the server image
via the workflow but leaves the seed task-def on its Terraform-pinned tag until the
operator runs `terraform apply` with the new `image_tag`. So a migration deploy
**obligates a prompt operator apply** so the nightly seed runs the matching image
(the M10-07 runbook cross-references this). The seed entrypoint runs
`migrate` then `demo:seed`, so it applies migrations for whatever image it runs.

## Keep-alive and reset (D6)

The nightly scheduler `RunTask` reseeds the database but **does not traverse the
VPC link**, so it does **not** reset the 60-day VPC-link idle timer. An idle VPC
link goes INACTIVE (ENIs reaped, requests fail, minutes to reprovision). The
**M10-08 external uptime ping** (hitting `https://demo.carlosgutz.com/health`) is
the keep-alive - do not remove it thinking the nightly job covers it.

## State

**Local state on the operator's machine**, gitignored. A remote backend
(S3 bucket + DynamoDB lock, or S3 native locking) is the named upgrade path when a
second operator or CI apply appears; deliberately deferred at solo scale. State
carries no secret (D4), so local state is not a secret-exposure risk - only a
single-machine-durability one (back up `terraform.tfstate` with the machine).

## Limits and the escape hatch

The HTTP API integration has a **30s timeout, 10MB payload, and no WebSockets/SSE**
- none bite the demo. If any is ever needed, the recorded escape hatch is an
Application Load Balancer (~$16.43/mo + LCU, priced in ADR-0022); it is a
find-and-amend, not a redesign.

## Usage (operator)

```
terraform init
terraform plan   # review; the two SSM params and the GHCR image must exist first
terraform apply  # operator, local; see docs/runbooks/demo-deploy.md for order
```

CI / this story runs only the offline checks:

```
terraform fmt -check
terraform init -backend=false
terraform validate
```

Copy `example.tfvars` to `terraform.tfvars` (gitignored) and fill in the real
`github_owner`, `github_repo`, `image_tag`, and `budget_notification_email`.

## Provider version

Pinned `hashicorp/aws ~> 6`. AWS provider majors move quickly; bump the pin and
re-run `init -upgrade` + `validate` as a deliberate step, never silently.
