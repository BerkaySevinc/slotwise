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
- Terraform bootstrap (`infra/bootstrap/`): remote state bucket and GitHub OIDC deploy role. Planned only, not applied.
- Shared agent permission rules (`.claude/settings.json`): secret files cannot be read; apply, destroy, commit and push need confirmation.
