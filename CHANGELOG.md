# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- README section "Before real users", with the move of the Cognito email to SES and the end of the AWS Free plan.
- MIT `LICENSE`, with the license named in the README, `package.json` and `api/openapi.yaml`, and the accepted ADR-0008 with the reasons and the conditions for revisiting it.
- Repository layout (`api/`, `backend/`, `frontend/`, `infra/`, `tests/`, `docs/`) with a README per component.
- `CLAUDE.md` with the working rules for AI coding agents.
- Accepted ADRs: tenancy model (0001), DynamoDB data model and slot locking (0002), infrastructure as code with Terraform (0003).
- Accepted ADR-0004: npm workspaces at the repository root.
- TypeScript workspace: root tooling (TypeScript 6.0 strict, ESLint, Prettier, Vitest, esbuild), lint, format, typecheck, test and build scripts, and an empty `@slotwise/shared` package.
- Terraform bootstrap (`infra/bootstrap/`): remote state bucket. The GitHub OIDC role was dropped because the account's organization policy denies creating IAM identity providers.
- Accepted ADR-0005: how CI reaches AWS without GitHub OIDC (supersedes the OIDC part of ADR-0003).
- Terraform bootstrap state moves into its own S3 bucket (key `bootstrap/terraform.tfstate`, native S3 locking). The bucket name is derived at init time from the signed-in AWS account, so no file holds the account id.
- Dev environment (`infra/envs/dev/`) with a throwaway `hello` Lambda (Node.js 24, arm64) behind a throttled HTTP API, to prove the deploy chain. The function lives in `backend/functions/hello/` with a unit test.
- Accepted ADR-0006: defer the automated deploy pipeline; deployments stay manual until the project runs in an account that allows GitHub OIDC.
- Accepted ADR-0007: owner registration and sign-in (Cognito standard sign-up, tenant created afterwards by an idempotent `POST /tenants`, `provisioning` state, slug rules, accepted pre-hijacking risk).
- OpenAPI skeleton (`api/openapi.yaml`) with the Cognito bearer scheme, the shared error body and `POST /tenants`, and the requirements with acceptance criteria for US-01 and US-02 (`docs/requirements/`).
- Cognito user pool and browser app client in the dev environment (`infra/envs/dev/cognito.tf`): email sign-in with required verification, custom attributes `custom:tenant_id` and `custom:role` that the app client cannot write, SRP sign-in only, 1 hour access and ID tokens and a 30 day refresh token.
- Root README: current status, a Getting started section (local development and AWS deployment prerequisites and commands) and the real CI/CD setup instead of the OIDC line.
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, format check, type check, tests and build, plus a gitleaks secret scan. Actions are pinned to commit SHAs and the workflow has read-only permissions.
- US-01 implementation: `tenant-api` Lambda with `POST /tenants` (registration transaction, provisioning recovery, Powertools idempotency, `ProvisioningIncomplete` metric), shared validation (zod), key builders, default settings and the tenant-required auth check in `@slotwise/shared`.
- Terraform for the application data table, the idempotency table, the `tenant-api` Lambda and role, a Cognito JWT authorizer, the `POST /tenants` route and the provisioning alarm (not yet applied).
- Integration tests against DynamoDB (`tests/integration/`), including the 50-parallel-request slug test; skipped unless `SLOTWISE_DATA_TABLE` is set.
- Contract test (responses of `POST /tenants` against `api/openapi.yaml`) and a log-content test for AC-01.19. `ajv` and `yaml` are test-only dependencies.
- Shared agent permission rules (`.claude/settings.json`): secret files (`.env` files at any depth, Terraform state, `*.tfvars`, `backend.hcl`, keys) cannot be read; apply, destroy, commit and push need confirmation.

### Fixed

- `tenant-api`: the provisioning-recovery update used the DynamoDB reserved word `timeZone` and was rejected; it is aliased now.
- `tenant-api`: under 50 parallel registrations some callers got `503 try_again` instead of `409 slug_taken`. After a transaction conflict the repository reads the slug item and retries with a longer, capped backoff.
- `tenant-api`: the ESM bundle failed at Lambda init (`Dynamic require of "node:https"`); the bundle gets a `createRequire` banner, and the build now imports the bundle as an ES module so this fails at build time.

### Removed

- The throwaway `hello` Lambda, its route and Terraform resources; `tenant-api` is the first real function.
