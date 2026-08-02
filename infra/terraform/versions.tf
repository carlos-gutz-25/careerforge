# Provider + version pins for the CareerForge public demo stack (M10-06).
# See docs/DECISIONS/0022-public-demo-deployment.md for the decision this codes.
#
# State is LOCAL and operator-machine-only (gitignored); a remote S3+lock backend
# is the named upgrade path in README.md, deliberately deferred at solo scale.
# The two real secrets never enter Terraform in any form (see D4 in README.md);
# they are pre-existing SSM SecureString parameters referenced by name.

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "careerforge-demo"
      ManagedBy = "terraform"
      Story     = "M10-06"
    }
  }
}
