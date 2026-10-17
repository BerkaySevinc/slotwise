locals {
  environment = "dev"
  name_prefix = "${var.project}-${local.environment}"
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = local.environment
      ManagedBy   = "terraform"
    }
  }
}
