# Example tfvars - FICTIONAL, name-only values. Copy to terraform.tfvars (which is
# gitignored) and fill in the real operator values. No secret VALUES ever go here
# or in any tfvars: the two real secrets are SSM SecureString parameters the
# operator creates out of band (docs/runbooks/demo-deploy.md), referenced by name.

github_owner              = "example-org"
github_repo               = "careerforge"
image_tag                 = "latest"
budget_notification_email = "ops@example.com"

# The following have working defaults (variables.tf); override only if needed:
# region                      = "us-east-2"
# demo_domain                 = "demo.carlosgutz.com"
# web_app_origin              = "https://demo.carlosgutz.com"
# bootstrap_email             = "demo@careerforge.example"
# database_url_ssm_name       = "/careerforge-demo/database-url"
# bootstrap_password_ssm_name = "/careerforge-demo/auth-bootstrap-password"
# seed_schedule_expression    = "cron(0 9 * * ? *)"
# budget_amount               = 20
