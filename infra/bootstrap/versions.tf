terraform {
  required_version = "~> 1.16"

  # The bucket name contains the account id, so it is not written here. Pass it at init time:
  # terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
