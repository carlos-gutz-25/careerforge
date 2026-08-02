# IAM: least-privilege roles for the task, the nightly scheduler, and the M10-07
# GitHub OIDC deploy (dormant until that workflow exists). The two SSM secret ARNs
# are the only parameter grants; no role can read anything else.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  ssm_secret_arns = [
    "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.database_url_ssm_name}",
    "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.bootstrap_password_ssm_name}",
  ]
}

# ---- ECS task execution role (image pull is public GHCR; needs logs + SSM) ----
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "careerforge-demo-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# Logs + (SecureString) parameter reads for exactly the two secrets.
data "aws_iam_policy_document" "task_execution" {
  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.demo.arn}:*"]
  }

  statement {
    sid       = "ReadTheTwoSecrets"
    actions   = ["ssm:GetParameters"]
    resources = local.ssm_secret_arns
  }

  statement {
    sid       = "DecryptSecureStringDefaultKey"
    actions   = ["kms:Decrypt"]
    resources = ["arn:${data.aws_partition.current.partition}:kms:${var.region}:${data.aws_caller_identity.current.account_id}:alias/aws/ssm"]
  }
}

resource "aws_iam_role_policy" "task_execution" {
  name   = "careerforge-demo-task-execution"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution.json
}

# ---- ECS task role (the app calls no AWS API; kept minimal, no policies) ----
resource "aws_iam_role" "task" {
  name               = "careerforge-demo-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ---- GitHub OIDC provider + deploy role (consumed by M10-07's workflow) ----
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "careerforge-demo-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume.json
}

# Minimal deploy set: register a new server task-def revision and roll the service
# to it. PassRole is scoped to exactly the task roles the new revision names.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid = "RegisterAndRoll"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PassTheTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.task_execution.arn, aws_iam_role.task.arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "careerforge-demo-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

# ---- EventBridge Scheduler role (runs the nightly seed task) ----
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "careerforge-demo-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "RunTheSeedTask"
    actions   = ["ecs:RunTask"]
    resources = ["${aws_ecs_task_definition.seed.arn_without_revision}:*"]
  }

  statement {
    sid       = "PassTheTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.task_execution.arn, aws_iam_role.task.arn]
    condition {
      test     = "StringLike"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "careerforge-demo-scheduler"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}
