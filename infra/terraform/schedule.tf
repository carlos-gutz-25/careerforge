# Nightly reset = reseed-is-the-backup (ADR-0022/0023): there is no separate DB
# backup because the seed IS the source of truth. EventBridge Scheduler runs the
# DEDICATED SEED task definition (ecs.tf) - not a command override on the server
# task, which the shipped ENTRYPOINT would ignore (binding note 2). The run does
# NOT traverse the VPC link, so it does not reset the 60-day link-idle timer; the
# M10-08 uptime ping is the keep-alive (README.md D6).

resource "aws_scheduler_schedule" "seed" {
  name = "careerforge-demo-nightly-seed"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.seed_schedule_expression
  schedule_expression_timezone = var.seed_schedule_timezone

  target {
    arn      = aws_ecs_cluster.demo.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.seed.arn
      task_count          = 1
      launch_type         = "FARGATE"

      network_configuration {
        subnets          = data.aws_subnets.public.ids
        security_groups  = [aws_security_group.task.id]
        assign_public_ip = true
      }
    }
  }
}
