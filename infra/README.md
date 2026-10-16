# Infrastructure

Terraform code for every AWS resource in the project. Nothing is created by hand in the console. **Status: not started.**

## Planned layout

| Path | Contents |
|---|---|
| `bootstrap/` | One-time setup: remote state bucket |
| `modules/` | Reusable modules (for example a Lambda function with its role and log group) |
| `envs/dev/` | Development environment |
| `envs/prod/` | Production environment |

## Bootstrap

`bootstrap/` creates the remote state bucket (private, versioned, encrypted, TLS only). A GitHub OIDC identity provider is not part of it: the account's organization policy denies creating IAM identity providers (see ADR-0005).

1. Log in: `aws login --profile slotwise`, then set `AWS_PROFILE=slotwise` in your shell.
2. Copy `bootstrap/backend.hcl.example` to `bootstrap/backend.hcl` and set the bucket name (`slotwise-tfstate-<account id>`). The real file is git-ignored.
3. From `bootstrap/`: `terraform init -backend-config=backend.hcl`, `terraform validate`, `terraform plan`.
4. `terraform apply` creates cloud resources. Review the plan first.

The state lives in the bucket this module creates (key `bootstrap/terraform.tfstate`, native S3 locking). On a brand new account the bucket does not exist yet: run `terraform init -backend=false` and apply once with local state, then move it with `terraform init -migrate-state -backend-config=backend.hcl`. The environment roots use the key prefix `envs/`.

## Rules

- Terraform state is never committed (it can contain secrets). The `.terraform.lock.hcl` file is committed.
- Variable files with real values are git-ignored; commit only `*.tfvars.example`.
- No long-lived access keys. Deployments use short-lived credentials (see ADR-0005 for how CI reaches AWS).
- All resource names start with the `slotwise` prefix plus the environment.
