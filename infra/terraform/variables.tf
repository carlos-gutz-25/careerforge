# Every operator-specific value is a variable with a fictional-or-empty example
# in example.tfvars (committed). NOTHING defaults to a real account artifact, and
# the two real secrets are NOT here (they are pre-existing SSM parameters
# referenced by name; see D4 in README.md).

variable "region" {
  description = "AWS region. Pinned to us-east-2 (matches the Neon project; Carlos-ratified 2026-08-02)."
  type        = string
  default     = "us-east-2"
}

variable "github_owner" {
  description = "GitHub org/user that owns the repo and the GHCR image (OIDC subject + image path)."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (OIDC trust subject: repo:<owner>/<repo>:ref:refs/heads/main)."
  type        = string
}

variable "image_tag" {
  description = "GHCR image tag to run (e.g. a commit SHA). First push is manual per the runbook; M10-07 automates thereafter."
  type        = string
  default     = "latest"
}

variable "demo_domain" {
  description = "Public demo hostname served by the API Gateway custom domain (CNAME at the registrar)."
  type        = string
  default     = "demo.carlosgutz.com"
}

variable "web_app_origin" {
  description = "WEB_APP_ORIGIN passed to the API (CSRF/cookie origin). The public demo URL."
  type        = string
  default     = "https://demo.carlosgutz.com"
}

variable "bootstrap_email" {
  description = "AUTH_BOOTSTRAP_EMAIL for the demo. The published, deliberately-public demo login (see ADR-0023)."
  type        = string
  default     = "demo@careerforge.example"
}

variable "database_url_ssm_name" {
  description = "Name of the pre-existing SSM SecureString holding the Neon DATABASE_URL. Created BY THE OPERATOR (runbook); Terraform references it by name only."
  type        = string
  default     = "/careerforge-demo/database-url"
}

variable "bootstrap_password_ssm_name" {
  description = "Name of the pre-existing SSM SecureString holding AUTH_BOOTSTRAP_PASSWORD. Created BY THE OPERATOR (runbook); the value is the published demo password (ADR-0023), so DATABASE_URL is the ceremony's real weight."
  type        = string
  default     = "/careerforge-demo/auth-bootstrap-password"
}

variable "task_cpu" {
  description = "Fargate task CPU units. 256 = 0.25 vCPU (the costed shape)."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate task memory (MiB). 512 = 0.5 GB (the costed shape)."
  type        = number
  default     = 512
}

variable "log_retention_days" {
  description = "CloudWatch log retention. 14 days (no PII/posting text in logs; the shipped logging law)."
  type        = number
  default     = 14
}

variable "seed_schedule_expression" {
  description = "EventBridge Scheduler expression for the nightly reseed (drop/truncate + demo:seed is idempotent)."
  type        = string
  default     = "cron(0 9 * * ? *)"
}

variable "seed_schedule_timezone" {
  description = "Timezone for the nightly reseed schedule."
  type        = string
  default     = "UTC"
}

variable "budget_amount" {
  description = "Monthly AWS Budgets limit (USD). The costed envelope is ~$13.26/mo; the alert guards drift."
  type        = number
  default     = 20
}

variable "budget_notification_email" {
  description = "Email for the AWS Budgets alert. Name-only; the example value is fictional."
  type        = string
}
