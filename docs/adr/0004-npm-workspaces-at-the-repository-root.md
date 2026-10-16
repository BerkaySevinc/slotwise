# ADR-0004: npm workspaces at the repository root

## Status

Accepted

## Context

The project has several TypeScript packages: one Lambda function per folder under `backend/functions/`, shared code in `backend/packages/shared/`, and a React SPA in `frontend/`. They need the same lint, format and TypeScript rules, one consistent set of dependency versions, and an easy way to use the shared package from every function.

## Decision

- **One npm workspace at the repository root.** The root `package.json` lists `backend/functions/*`, `backend/packages/*` and `frontend/` as workspaces. There is one `npm install` and one `package-lock.json`. `frontend/` joins the list when it gets its own `package.json`.
- **Shared tooling at the root.** ESLint, Prettier, Vitest, TypeScript, esbuild and `@types/node` are root dev dependencies with exact versions. A root `tsconfig.base.json` holds the strict compiler options and each package extends it.
- **Root scripts run everything:** `lint`, `format`, `format:check`, `typecheck`, `test` and `build`. CI runs the same scripts. `build` runs each workspace's own `build` script, which bundles a function with esbuild.
- **Unit tests live next to the code** as `*.test.ts`.
- **Node 24** is pinned in `engines` and `.nvmrc`; TypeScript stays on 6.0 as recorded in `CLAUDE.md`.
- **Packages import the shared package by name** (`@slotwise/shared`), and the Lambda bundles include its code through esbuild.

## Consequences

- One install and one version set make dependency drift between packages impossible.
- A tooling upgrade at the root affects every package at once. That is the intended effect for a single-developer project, but it means upgrades need the full test run.
- Frontend and backend dependencies share one `node_modules`. Each package must declare its own dependencies so a function bundle never pulls in a frontend library by accident.
- Terraform and the OpenAPI file stay outside the workspace.

## Alternatives considered

- **Separate install per component:** independent upgrades, but shared code needs publishing or linking, and lint and TypeScript settings get duplicated and drift apart.
- **A monorepo build tool (Nx, Turborepo):** useful for caching in large repositories; the extra tool is not justified at this size.
