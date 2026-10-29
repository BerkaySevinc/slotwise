# Infrastructure

Terraform code for every AWS resource in the project. Nothing is created by hand in the console. **Status:** the bootstrap is applied; the dev environment holds the Cognito user pool and (once applied) the tenant data tables, `tenant-api` and `catalog-api`.

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
2. From `bootstrap/`: run the `terraform init` command from [State backend](#state-backend), then `terraform validate` and `terraform plan`.
3. `terraform apply` creates cloud resources. Review the plan first.

The state lives in the bucket this module creates (key `bootstrap/terraform.tfstate`, native S3 locking). On a brand new account the bucket does not exist yet: run `terraform init -backend=false` and apply once with local state, then move it with the `init` command from [State backend](#state-backend) plus `-migrate-state`. The environment roots use the key prefix `envs/`.

## State backend

Every root stores its state in the bucket `slotwise-tfstate-<account id>`. The account id is not written in any file: it is derived from the account you are signed in to, so the same command works on any machine and in CI. It works in PowerShell and in bash:

```
terraform init "-backend-config=bucket=slotwise-tfstate-$(aws sts get-caller-identity --query Account --output text)"
```

Run it once per folder (and again when providers or the backend change).

## Dev environment

`envs/dev/` holds the development stack: an HTTP API (`slotwise-dev-api`), the Cognito user pool, the data tables and the `tenant-api` and `catalog-api` Lambdas.

1. Build the function bundles from the repository root: `npm run build`. Terraform zips each `backend/functions/<name>/dist/index.mjs`.
2. From `envs/dev/`: run the `terraform init` command from [State backend](#state-backend), then `terraform validate` and `terraform plan`.
3. `terraform apply` creates cloud resources. Review the plan first. The `api_url` output is the base URL.

`cognito.tf` holds the Cognito user pool and the browser app client (ADR-0001, ADR-0007). The pool has the custom attributes `custom:tenant_id` and `custom:role`; the app client reads them but cannot write them. The outputs `user_pool_id`, `user_pool_client_id` and `user_pool_issuer` feed the frontend and the API Gateway JWT authorizer. The pool sends email through Cognito's default sender (50 emails per day per AWS account); switch it to SES before real owners sign up. Changing the custom attributes replaces the pool and deletes its users.

`dynamodb.tf` holds the application table (`slotwise-dev-data`, ADR-0002: `PK`/`SK`, `GSI1` to `GSI4`, on-demand, point-in-time recovery, TTL attribute `expiresAt`) and the Powertools idempotency table (`slotwise-dev-idempotency`, key `id`, TTL attribute `expiration`). `tenant_api.tf` holds the `tenant-api` Lambda with its least-privilege role, the `POST /tenants` route and the alarm for failed Cognito provisioning. The route is protected by a JWT authorizer (`api.tf`) that expects the Cognito **ID token** (only it carries the tenant and role claims). Run `npm run build` before `terraform plan` so both bundles exist. `catalog_api.tf` holds the `catalog-api` Lambda (its role can read, batch-read, put, update and query the data table but not delete) and its eight `/services` and `/staff` routes behind the same authorizer. Output `data_table_name` is used by the integration tests.

The state key is `envs/dev/terraform.tfstate`. The stage throttles every route to 5 requests per second (burst 10).

## Rules

- Terraform state is never committed (it can contain secrets). The `.terraform.lock.hcl` file is committed.
- Variable files with real values are git-ignored; commit only `*.tfvars.example`.
- No long-lived access keys. Deployments use short-lived credentials and run from the owner's machine for now (see ADR-0005 and ADR-0006).
- Resource names are `local.name_prefix` (`slotwise` plus the environment) followed by what the resource is, for example `slotwise-dev-api` or `slotwise-dev-users`. Do not use the bare prefix, except for a resource that is the environment itself (for example a VPC or a cluster).
