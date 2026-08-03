# ECS Fargate: one always-on service (the API + same-origin SPA) plus a dedicated
# seed task definition the nightly schedule runs. See ADR-0022 for the shape and
# ADR-0023 for the demo-mode semantics the env encodes.
#
# Task-definition ownership (binding note 3): the SERVICE ignores task_definition
# changes, so image revisions the M10-07 deploy workflow registers do not get
# rolled back by an operator `terraform apply`. The SEED task definition stays
# Terraform-owned (NOT ignored); a migration-bearing deploy therefore obligates a
# prompt operator apply so the seed image tracks the server image (README.md).

locals {
  container_name = "api"
  image          = "ghcr.io/${var.github_owner}/careerforge-demo:${var.image_tag}"

  # Non-secret environment (ADR-0023). The two real secrets are injected from SSM
  # (below), never set here. ANTHROPIC_API_KEY is deliberately absent - a demo is
  # keyless and the env layer refuses to boot if a key is present with DEMO_MODE.
  environment = [
    { name = "DEMO_MODE", value = "1" },
    { name = "TRUST_PROXY", value = "1" },
    { name = "NODE_ENV", value = "production" },
    { name = "API_HOST", value = "0.0.0.0" },
    { name = "WEB_DIST_DIR", value = "/app/web-dist" },
    { name = "WEB_APP_ORIGIN", value = var.web_app_origin },
    { name = "AUTH_BOOTSTRAP_EMAIL", value = var.bootstrap_email },
    { name = "LOG_LEVEL", value = "info" },
  ]

  # SSM SecureString parameters created BY THE OPERATOR (runbook). Referenced by
  # ARN built from name so no value ever transits Terraform code or state (D4).
  secrets = [
    {
      name      = "DATABASE_URL"
      valueFrom = "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.database_url_ssm_name}"
    },
    {
      name      = "AUTH_BOOTSTRAP_PASSWORD"
      valueFrom = "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.bootstrap_password_ssm_name}"
    },
  ]
}

resource "aws_cloudwatch_log_group" "demo" {
  name              = "/ecs/careerforge-demo"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "demo" {
  name = "careerforge-demo"
}

# Task security group: NO public ingress port. The only ingress is 4301 from the
# API Gateway VPC-link ENIs (ingress.tf). The public IP the task carries is for
# EGRESS ONLY (GHCR pull + Neon).
resource "aws_security_group" "task" {
  name        = "careerforge-demo-task"
  description = "Fargate task: ingress 4301 from the VPC link only; egress open."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "API port, reachable only from the API Gateway VPC link."
    from_port       = 4301
    to_port         = 4301
    protocol        = "tcp"
    security_groups = [aws_security_group.vpc_link.id]
  }

  egress {
    description = "Egress for the GHCR image pull and the Neon connection."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Cloud Map service the API Gateway private integration discovers; the ECS service
# registers its task ENI here (service_registries below).
resource "aws_service_discovery_private_dns_namespace" "demo" {
  name        = "careerforge-demo.local"
  description = "Cloud Map private DNS namespace for the demo API. SRV records let ECS register the task port (AWS_INSTANCE_PORT) so the API Gateway VPC-link integration can reach the task on 4301; an HTTP namespace registers no port (API GW 500). M10-08 finding F4."
  vpc         = data.aws_vpc.default.id
}

resource "aws_service_discovery_service" "api" {
  name = "api"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.demo.id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "SRV"
      ttl  = 15
    }
  }
}

# Main task definition: the shipped image runs its own ENTRYPOINT
# (docker-entrypoint.sh = migrate-then-serve), so NO command/entryPoint override.
resource "aws_ecs_task_definition" "server" {
  family                   = "careerforge-demo-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name        = local.container_name
      image       = local.image
      essential   = true
      environment = local.environment
      secrets     = local.secrets
      portMappings = [
        { containerPort = 4301, protocol = "tcp" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.demo.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "server"
        }
      }
    },
  ])
}

# Dedicated SEED task definition (binding note 2): the nightly schedule runs THIS,
# not a command override on the server task - the shipped ENTRYPOINT ignores args,
# so a bare command override would boot a second server. A container-level
# entryPoint override runs migrate-then-seed instead; demo:seed is keyless and
# idempotent (truncate + reseed) and requires DEMO_MODE=1 (present in the env).
resource "aws_ecs_task_definition" "seed" {
  family                   = "careerforge-demo-seed"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name        = "${local.container_name}-seed"
      image       = local.image
      essential   = true
      environment = local.environment
      secrets     = local.secrets
      entryPoint  = ["/bin/sh", "-c"]
      command     = ["node packages/db/src/cli/migrate.ts && node apps/api/src/cli/demo-seed.ts"]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.demo.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "seed"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "server" {
  name            = "careerforge-demo"
  cluster         = aws_ecs_cluster.demo.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.public.ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.api.arn
    # The Cloud Map service uses SRV records (private DNS namespace above), so ECS
    # registers the task port here as AWS_INSTANCE_PORT; the API Gateway VPC-link
    # integration needs it to reach the task on 4301. An HTTP namespace registers
    # no port and AWS rejects containerPort there -> API GW 500. M10-08 finding F4.
    container_name = local.container_name
    container_port = 4301
  }

  # Binding note 3: the M10-07 deploy workflow registers new server task-def
  # revisions; without this, an operator `terraform apply` would roll the service
  # back to the Terraform-pinned revision. The seed task-def is unaffected (it is
  # run by the scheduler, not this service).
  lifecycle {
    ignore_changes = [task_definition]
  }
}
