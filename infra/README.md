# Infrastructure

Terraform code for every AWS resource in the project. Nothing is created by hand in the console. **Status: not started.**

## Planned layout

| Path | Contents |
|---|---|
| `bootstrap/` | One-time setup: remote state bucket with locking, GitHub OIDC role |
| `modules/` | Reusable modules (for example a Lambda function with its role and log group) |
| `envs/dev/` | Development environment |
| `envs/prod/` | Production environment |

## Rules

- Terraform state is never committed (it can contain secrets). The `.terraform.lock.hcl` file is committed.
- Variable files with real values are git-ignored; commit only `*.tfvars.example`.
- CI authenticates to AWS through OIDC; no long-lived access keys.
- All resource names start with the `slotwise` prefix plus the environment.
