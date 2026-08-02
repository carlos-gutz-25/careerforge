# Network: reuse the account's default VPC and its public subnets rather than
# provisioning a new VPC - one fewer thing to own at solo scale (recorded in
# README.md). The task runs in a public subnet with a public IP for EGRESS ONLY
# (GHCR pull + Neon); no public ingress port exists (see the security group in
# ecs.tf). The NAT-gateway alternative was rejected at ~$32/mo.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}
