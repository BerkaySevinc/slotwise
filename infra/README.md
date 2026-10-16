# Infrastructure

Terraform code for every AWS resource in the project. Nothing is created by hand in the console. **Status: not started.**

## Planned layout

| Path | Contents |
|---|---|
| `bootstrap/` | One-time setup: remote state bucket with locking, GitHub OIDC role |
| `modules/` | Reusable modules (for example a Lambda function with its role and log group) |
| `envs/dev/` | Development environment |
| `envs/prod/` | Production environment |

## Bootstrap

`bootstrap/` creates the remote state bucket (private, versioned, encrypted, TLS only) and the GitHub OIDC identity provider with a deploy role. Only workflows of the configured repository that run on `main` or on a `v*` tag can assume the role, and its permissions are limited to `slotwise-*` resources.

1. Log in: `aws login --profile slotwise`, then set `AWS_PROFILE=slotwise` in your shell.
2. Copy `bootstrap/terraform.tfvars.example` to `bootstrap/terraform.tfvars` and set `github_repository`. The real file is git-ignored.
3. From `bootstrap/`: `terraform init`, `terraform validate`, `terraform plan`.
4. `terraform apply` creates cloud resources. Review the plan first.

The first apply uses local state, which is git-ignored. Moving the bootstrap state into its own bucket is a separate step after the first apply. The environment roots will use `use_lockfile = true` with the key prefix `envs/`.

## Rules

- Terraform state is never committed (it can contain secrets). The `.terraform.lock.hcl` file is committed.
- Variable files with real values are git-ignored; commit only `*.tfvars.example`.
- CI authenticates to AWS through OIDC; no long-lived access keys.
- All resource names start with the `slotwise` prefix plus the environment.
