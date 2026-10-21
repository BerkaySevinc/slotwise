# ADR-0006: Defer automated deployment

## Status

Accepted

## Context

ADR-0005 chose AWS CodeBuild as the deploy path because the account's organization policy blocks the GitHub OIDC identity provider. The CodeBuild pipeline is not built yet; deployments run from the owner's machine with the short-lived credentials of `aws login`.

The account is on the Free plan, which ends around April 2027. The project will then move to a real account (or an upgraded one) where GitHub OIDC is expected to work. A CodeBuild pipeline built now would be replaced at that point, and it would need a broad deploy role, a console-only GitHub connection and its own maintenance, for a project with a single developer and no production users.

## Decision

- **Do not build the CodeBuild pipeline during the Free plan period.** Deployments stay manual: build, `terraform plan`, review, `terraform apply`, from the owner's machine with short-lived credentials. The steps are documented in `infra/README.md`. Nothing is applied by an agent without the owner's confirmation.
- **GitHub Actions keeps running the checks** that need no AWS credentials (lint, format, type check, tests, build, secret scanning). Pull requests to `main` are the review gate.
- **Build the automated deploy pipeline on GitHub Actions with OIDC** once the project runs in an account that allows it, as ADR-0003 originally intended. If that account still blocks OIDC, revisit CodeBuild from ADR-0005 then.
- **Revisit date:** at the start of Phase 3 (hardening), or when the account is upgraded or replaced, whichever comes first.

## Consequences

- No time is spent on throwaway pipeline work; Phases 1 and 2 go to the product.
- Deploys depend on the owner remembering to build before `apply` and to review the plan. The documented steps and the plan review are the only guard.
- No audit trail of deployments beyond Git history and Terraform state.
- The Phase 0 exit criterion "a hello-world endpoint deployed through the pipeline" is met by a manual deploy of the same Terraform code. The deployed chain (build, package, state, API Gateway) is proven; only the trigger is manual.
- ADR-0005 stays accepted for its reasons (OIDC is blocked on this account). When this ADR is accepted, ADR-0005's CodeBuild deploy decision is superseded by it, and ADR-0005's status line is updated then.

## Alternatives considered

- **Build the CodeBuild pipeline now (ADR-0005):** automation and an audit trail, but throwaway work and a broad deploy role that exists only for this account's limits.
- **Upgrade the account now to unlock OIDC:** irreversible and removes the spend limits; not justified before there is a real need.
