# Outputs the operator needs for the registrar steps and M10-07. No secret-adjacent
# values (the two SSM secrets never enter Terraform, so they cannot be output).

output "api_gateway_domain_target" {
  description = "Regional target for the demo.carlosgutz.com CNAME at the registrar (runbook step 5)."
  value       = one(aws_apigatewayv2_domain_name.demo.domain_name_configuration[*].target_domain_name)
}

output "acm_validation_records" {
  description = "DNS-validation CNAME name/value pairs to add at the registrar before the domain resolves (runbook step 5)."
  value = [
    for o in aws_acm_certificate.demo.domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ]
}

output "deploy_role_arn" {
  description = "GitHub OIDC deploy role ARN, consumed by the M10-07 deploy-demo.yml workflow."
  value       = aws_iam_role.deploy.arn
}

output "log_group_name" {
  description = "CloudWatch log group for the task (retention 14 days)."
  value       = aws_cloudwatch_log_group.demo.name
}
