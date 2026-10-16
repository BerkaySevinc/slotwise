# ADR-0005: CI access to AWS without GitHub OIDC

## Status

Accepted

## Context

ADR-0003 chose GitHub Actions with OIDC federation for deployments. Creating the OIDC identity provider failed: an organization policy on the account explicitly denies creating IAM identity providers, and the account owner cannot change that policy while the account stays on its current plan. Long-lived access keys are not an option (they are forbidden by the project rules and the account does not allow IAM users).

The same account policy does allow the AWS services needed to run a pipeline inside the account: CodeBuild, CodeConnections (the GitHub connection) and IAM role creation. This is taken from the provider's documentation and has not been verified in practice yet.

## Decision

- **No OIDC provider or OIDC deploy role** is created for now. Nothing in the repository assumes one.
- **GitHub Actions keeps doing everything that needs no AWS credentials:** lint, type check, unit tests, build and secret scanning.
- **Deployments run in AWS through CodeBuild**, triggered by a merge to `main`. CodeBuild runs `terraform plan` and `terraform apply` with its own service role, whose permissions are limited to the `slotwise-*` resources and the project Region. The GitHub connection is created once in the console (a manual, one-time step) and the rest is Terraform.
- **Until CodeBuild is verified**, the owner deploys from their machine with the short-lived credentials of `aws login`. State stays in the remote state bucket either way.
- **Revisit OIDC** if the account is later upgraded in a way that lifts the policy. Then the deploy path can move back to GitHub Actions with a new ADR.

## Consequences

- Automation, an audit trail (CodeBuild logs in CloudWatch) and repeatable deployments are kept without any stored credential.
- The pipeline is split across two systems (GitHub Actions for checks, CodeBuild for deploys), which is slightly harder to follow than a single workflow.
- The CodeBuild service role is a broad deploy role. It carries the same residual risk as an OIDC role would: whoever can change what runs on `main` can deploy. Branch protection and required checks on `main` matter once this exists.
- The GitHub connection needs one manual approval in the console, which is the only step not captured in code.
- If CodeBuild turns out to be blocked in practice, deployments stay manual from the owner's machine and this ADR is updated before it is accepted.

## Alternatives considered

- **Upgrade the account and activate advanced features now:** documented to allow editing the organization policies, but it is irreversible and removes spend limits. Deferred until a real need appears.
- **Self-hosted runner on the owner's machine:** unsafe in a public repository, because a fork's pull request could run code on that machine.
- **IAM Roles Anywhere:** needs a private key stored in CI, which is a long-lived secret, and is likely blocked by the same policy.
- **Manual deployments only:** simplest, but loses automation, an audit trail and repeatability.
