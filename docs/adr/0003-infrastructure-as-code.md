# ADR-0003: Infrastructure as code with Terraform

## Status

Accepted

## Context

Every AWS resource must be defined in code, deployed from CI without long-lived keys, and reviewable in a pull request. The project is one AWS account with a single Region (`eu-north-1`), a Free-plan budget and a serverless-only design. The IaC tool should be portable and widely recognized, and it has to cover every resource type in the project (API Gateway, Lambda, DynamoDB, Cognito, EventBridge, SQS, SES, S3, CloudFront, CloudWatch, IAM), not only Lambda.

## Decision

- **Terraform 1.16** with the **AWS provider pinned to major version 6** (`~> 6.0`). `required_version` and the committed `.terraform.lock.hcl` fix the versions for local runs and CI.
- **Layout:**
  - `infra/bootstrap/`: one-time setup of the remote state bucket and the GitHub OIDC identity provider and deploy role.
  - `infra/modules/`: reusable modules, for example a Lambda function with its role, log group and alarms.
  - `infra/envs/dev/` and `infra/envs/prod/`: one root module per environment.
- **Remote state:** a private, versioned, encrypted S3 bucket with the native S3 lock file (`use_lockfile = true`), so no DynamoDB lock table is needed. The bootstrap is applied once with local state and then migrated into its own bucket under a separate key. State is never committed.
- **Environments share the account** and are separated by name: every resource starts with `slotwise-{env}-`.
- **Account id and Region are variables**, never literals. Variable files with real values are git-ignored; only `*.tfvars.example` is committed.
- **Packaging:** esbuild bundles each function; `archive_file` zips the bundle; Terraform deploys it. Function code is not deployed by a separate tool.
- **CI/CD:** GitHub Actions authenticates through OIDC and assumes the deploy role. `terraform plan` runs on pull requests; apply to `dev` runs on merge to `main`; `prod` needs a version tag and manual approval. Nothing is applied by an agent or from a laptop without the owner's confirmation.
- **Fallbacks:**
  - If the account's guardrails block creating the OIDC provider or IAM roles, CI runs only lint, tests and secret scanning, and deployments run from the owner's machine with short-lived CLI credentials.
  - If a hello-world endpoint is not deployed through the pipeline by the end of Phase 0, reconsider AWS SAM rather than mixing tools.

## Consequences

- One tool and one state model for all resources; the plan output is the review artifact.
- The state bucket is the one resource created before Terraform manages itself, so the bootstrap needs a documented one-time procedure.
- `dev` and `prod` in one account cost less and are simpler, but they share account-level quotas and a mistake with broad IAM rights can touch both. Prefixed names and separate state keys limit this.
- CloudFront custom domains are probably unavailable (certificates must live in `us-east-1` and the project is fixed to one Region), so the demo uses the default CloudFront domain.

## Alternatives considered

- **AWS SAM:** simple for Lambda and API Gateway, weaker for the rest of the stack and less portable. Kept as the fallback.
- **AWS CDK:** familiar language, but synthesizes CloudFormation, adds a bootstrap stack and abstracts away the resource model.
- **Serverless Framework / Syndicate-style frameworks:** niche or vendor-bound; the project avoids them.
- **DynamoDB-based state locking:** deprecated in favor of the native S3 lock file.
