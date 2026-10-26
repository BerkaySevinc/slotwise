# Slotwise

A multi-tenant online booking platform for small appointment-based businesses (barbers, hair salons, clinics, dietitians). Design goals: each business gets a branded public booking page and a dashboard, customers book a slot without creating an account, and a slot is never double-booked, even under concurrent requests.

> **Status:** Phase 0 (foundation). The tooling, CI, Terraform state backend, the Cognito user pool and the `tenant-api` Lambda (`POST /tenants`) and the `catalog-api` Lambda (services) behind an HTTP API are in place. The booking features are not started.

## Planned stack

- **Backend:** TypeScript on AWS Lambda behind API Gateway
- **Data and identity:** DynamoDB (single table), Cognito
- **Async work:** EventBridge, EventBridge Scheduler, SQS with a DLQ, SES
- **Frontend:** React + Vite + TypeScript, hosted on S3 + CloudFront
- **Infrastructure:** Terraform
- **CI/CD:** GitHub Actions runs lint, type check, tests, build and secret scanning. Deployments run from the owner's machine for now, because the account cannot use GitHub OIDC (see [ADR-0005](docs/adr/0005-ci-access-to-aws-without-github-oidc.md)); an automated deploy pipeline waits for an account that allows it (see [ADR-0006](docs/adr/0006-defer-automated-deployment.md)).

## Getting started

### Local development (no AWS account needed)

Prerequisites: [Git](https://git-scm.com/) and [Node.js 24](https://nodejs.org/) (the version in `.nvmrc`; `nvm use` selects it). npm comes with Node.

```
git clone https://github.com/BerkaySevinc/slotwise.git
cd slotwise
npm ci
```

Run the same checks as CI before opening a pull request:

```
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

`npm run format` fixes formatting. Optionally scan for secrets before committing with [gitleaks](https://github.com/gitleaks/gitleaks): `gitleaks git . --redact` and `gitleaks dir . --redact`.

### Deploying to AWS (your own account)

Only needed to run the infrastructure. You need [Terraform](https://developer.hashicorp.com/terraform/install) 1.16, [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) v2 (a version that supports `aws login`) and an AWS account. The state bucket name contains the account id, so everyone creates their own copy in their own account.

Follow [`infra/README.md`](infra/README.md): sign in, create the state bucket once with the bootstrap, then initialize and plan the `dev` environment. `terraform apply` creates cloud resources; review the plan first. No long-lived access keys are used anywhere.

## Repository layout

| Path | Contents |
|---|---|
| [`api/`](api/) | OpenAPI contract shared by backend and frontend |
| [`docs/`](docs/) | Architecture decision records and design notes |
| [`backend/`](backend/) | Lambda functions and shared libraries |
| [`frontend/`](frontend/) | Single-page application |
| [`infra/`](infra/) | Terraform code |
| [`tests/`](tests/) | Contract, concurrency, cross-tenant and end-to-end tests |

## Roadmap

Foundation, core booking, notifications and branding, then hardening and a pilot with a real business.

## Before real users

What works for development but must change before real people sign up:

- **Email.** Cognito sends the sign-up verification codes with its default sender, which is limited to 50 emails per day for the whole AWS account. Before real owners sign up, move the user pool to Amazon SES: a domain of its own, a verified sender in `eu-north-1`, SES production access (the account starts in the sandbox, and approval can take days, so ask early) and `email_sending_account = "DEVELOPER"` in `infra/envs/dev/cognito.tf`. Background in [ADR-0007](docs/adr/0007-owner-registration-and-sign-in.md). The booking emails of the notification stories use SES as well.
- **AWS account.** The project runs on the AWS Free plan, which ends after a limited time or when the credit is used up (the end date is shown in AWS Settings). When it ends, the account closes and its data is kept for a limited time unless it is upgraded to the paid plan. Before a demo or a pilot has to stay online, upgrade or move to a regular account. Set a project spend limit and a Budgets alert first, because the Free plan's protection against charges ends with it. The same step decides the deployment pipeline: GitHub OIDC is blocked on the Free plan, so deployments are manual today. After the upgrade, revisit the pipeline with a new ADR. Background in [ADR-0005](docs/adr/0005-ci-access-to-aws-without-github-oidc.md) and [ADR-0006](docs/adr/0006-defer-automated-deployment.md).

## License

Released under the [MIT License](LICENSE). The choice can change later; see [ADR-0008](docs/adr/0008-license.md) for the reasons and for when it will be revisited.
