# Ingress: API Gateway HTTP API -> VPC Link V2 -> the Cloud Map service the ECS
# task registers into. NO load balancer (an ALB would cost ~$16.43/mo, more than
# the container). Recorded limits, none biting the demo: 30s integration timeout,
# 10MB payload, no WebSockets/SSE (the ALB escape hatch is named in README.md and
# priced in ADR-0022). TLS is a free regional ACM cert; demo.carlosgutz.com is a
# plain registrar CNAME (Route 53 deliberately not used).

# Security group for the VPC-link ENIs: they initiate connections to the task on
# 4301 (the task SG admits exactly this group; ecs.tf).
resource "aws_security_group" "vpc_link" {
  name        = "careerforge-demo-vpc-link"
  description = "API Gateway VPC link ENIs; egress to the task on 4301."
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "Reach the Fargate task API port."
    from_port   = 4301
    to_port     = 4301
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_apigatewayv2_vpc_link" "demo" {
  name               = "careerforge-demo"
  subnet_ids         = data.aws_subnets.public.ids
  security_group_ids = [aws_security_group.vpc_link.id]
}

resource "aws_apigatewayv2_api" "demo" {
  name          = "careerforge-demo"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "demo" {
  api_id             = aws_apigatewayv2_api.demo.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.demo.id
  integration_uri    = aws_service_discovery_service.api.arn

  # The demo API's own 30s ceiling matches the HTTP API hard limit (recorded).
  timeout_milliseconds = 30000
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.demo.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.demo.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.demo.id
  name        = "$default"
  auto_deploy = true
}

# Free regional ACM cert; DNS validation via a registrar CNAME (runbook step).
resource "aws_acm_certificate" "demo" {
  domain_name       = var.demo_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_domain_name" "demo" {
  domain_name = var.demo_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.demo.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "demo" {
  api_id      = aws_apigatewayv2_api.demo.id
  domain_name = aws_apigatewayv2_domain_name.demo.id
  stage       = aws_apigatewayv2_stage.default.id
}
