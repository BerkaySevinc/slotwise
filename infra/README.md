# Infrastructure

Terraform code for every AWS resource in the project. Nothing is created by hand in the console. **Status:** the bootstrap is applied; the dev environment holds a smoke test only.

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

`envs/dev/` holds the development stack. Today it only contains a throwaway smoke test: the `hello` Lambda behind an HTTP API (`GET /hello`), used to prove that code, packaging, remote state and API Gateway work end to end. It is deleted once real functions exist.

1. Build the function bundle from the repository root: `npm run build`. Terraform zips `backend/functions/hello/dist/index.mjs`.
2. From `envs/dev/`: run the `terraform init` command from [State backend](#state-backend), then `terraform validate` and `terraform plan`.
3. `terraform apply` creates cloud resources. Review the plan first. The `api_url` output is the base URL; call `<api_url>/hello`.

`cognito.tf` holds the Cognito user pool and the browser app client (ADR-0001, ADR-0007). The pool has the custom attributes `custom:tenant_id` and `custom:role`; the app client reads them but cannot write them. The outputs `user_pool_id`, `user_pool_client_id` and `user_pool_issuer` feed the frontend and the API Gateway JWT authorizer. The pool sends email through Cognito's default sender (50 emails per day per AWS account); switch it to SES before real owners sign up. Changing the custom attributes replaces the pool and deletes its users.

The state key is `envs/dev/terraform.tfstate`. The endpoint is public and unauthenticated by design, throttled to 5 requests per second (burst 10), and returns a static JSON body.

## Rules

- Terraform state is never committed (it can contain secrets). The `.terraform.lock.hcl` file is committed.
- Variable files with real values are git-ignored; commit only `*.tfvars.example`.
- No long-lived access keys. Deployments use short-lived credentials and run from the owner's machine for now (see ADR-0005 and ADR-0006).
- All resource names start with the `slotwise` prefix plus the environment.
