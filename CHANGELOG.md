# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Repository layout (`api/`, `backend/`, `frontend/`, `infra/`, `tests/`, `docs/`) with a README per component.
- `CLAUDE.md` with the working rules for AI coding agents.
- Accepted ADRs: tenancy model (0001), DynamoDB data model and slot locking (0002), infrastructure as code with Terraform (0003).
- Accepted ADR-0004: npm workspaces at the repository root.
- TypeScript workspace: root tooling (TypeScript 6.0 strict, ESLint, Prettier, Vitest, esbuild), lint, format, typecheck, test and build scripts, and an empty `@slotwise/shared` package.
- Terraform bootstrap (`infra/bootstrap/`): remote state bucket. The GitHub OIDC role was dropped because the account's organization policy denies creating IAM identity providers.
- Accepted ADR-0005: how CI reaches AWS without GitHub OIDC (supersedes the OIDC part of ADR-0003).
- Terraform bootstrap state moves into its own S3 bucket (key `bootstrap/terraform.tfstate`, native S3 locking). The bucket name is passed through a git-ignored `backend.hcl`.
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, format check, type check, tests and build, plus a gitleaks secret scan. Actions are pinned to commit SHAs and the workflow has read-only permissions.
- Shared agent permission rules (`.claude/settings.json`): secret files (`.env` files at any depth, Terraform state, `*.tfvars`, `backend.hcl`, keys) cannot be read; apply, destroy, commit and push need confirmation.
