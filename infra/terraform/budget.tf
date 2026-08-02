# AWS Budgets alert guarding the ~$13.26/mo envelope (ADR-0022). Notifies on both
# a threshold breach of actual spend and a forecasted breach, so drift surfaces
# before the bill does. The email is an operator variable (fictional in example).

resource "aws_budgets_budget" "demo" {
  name         = "careerforge-demo-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_amount)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_notification_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_notification_email]
  }
}
