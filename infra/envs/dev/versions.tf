terraform {
  required_version = "~> 1.16"

  # The bucket name contains the account id, so it is not written here. Pass it at init time,
  # derived from the signed-in account (see infra/README.md).
  backend "s3" {
    key          = "envs/dev/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
