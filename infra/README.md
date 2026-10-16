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
2. From `bootstrap/`: `terraform init`, `terraform validate`, `terraform plan`.
3. `terraform apply` creates cloud resources. Review the plan first.

The first apply uses local state, which is git-ignored. Moving the bootstrap state into its own bucket is a separate step after the first apply. The environment roots will use `use_lockfile = true` with the key prefix `envs/`.

## Rules

- Terraform state is never committed (it can contain secrets). The `.terraform.lock.hcl` file is committed.
- Variable files with real values are git-ignored; commit only `*.tfvars.example`.
- No long-lived access keys. Deployments use short-lived credentials (see ADR-0005 for how CI reaches AWS).
- All resource names start with the `slotwise` prefix plus the environment.
