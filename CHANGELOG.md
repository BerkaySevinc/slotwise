# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Repository layout (`api/`, `backend/`, `frontend/`, `infra/`, `tests/`, `docs/`) with a README per component.
- `CLAUDE.md` with the working rules for AI coding agents.
- Shared agent permission rules (`.claude/settings.json`): secret files cannot be read; apply, destroy, commit and push need confirmation.
