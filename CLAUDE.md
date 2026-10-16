# Slotwise

Multi-tenant appointment booking platform for small businesses (first vertical: barbers and hair salons). Serverless on AWS: TypeScript Lambdas behind API Gateway, DynamoDB (single table), Cognito, EventBridge, SQS and SES, a React frontend on S3 and CloudFront, Terraform, GitHub Actions. This is a public repository.

## Where things live

- `api/openapi.yaml`: the API contract. It is written before the handlers (not created yet).
- `backend/functions/<name>/`: one Lambda function per folder. `backend/packages/shared/`: shared code.
- `frontend/`: React SPA. `infra/`: Terraform (`bootstrap/`, `modules/`, `envs/`). `tests/`: contract, concurrency, cross-tenant and end-to-end tests (unit tests live next to the code).
- `docs/adr/`: architecture decision records (created with the first ADR). Read the relevant ADR before changing a decision it covers.
- Each top-level component has a README. Read it before changing that component.

## Rules that must not be broken

1. **Tenant isolation.** The tenant id comes only from the verified JWT, never from the path or body. A resource of another tenant returns `404`. Every authenticated endpoint has a cross-tenant negative test.
2. **Never trust the client** for price, duration, tenant id or role. Compute them server-side and snapshot service name, duration and price into the appointment.
3. **No double booking.** Overlap is prevented in the database with slot-lock items written in the same `TransactWriteItems` as the appointment. Locks use a fixed 5-minute grid, independent of the tenant's slot granularity. An application-level check alone is never enough.
4. **Time.** Store UTC. Each tenant has an IANA time zone. Availability must be DST-safe and tested with `Europe/Istanbul` and one DST zone.
5. **HTTP semantics.** Malformed or null bodies return `400`, never `500`. Slot conflicts return `409`. Booking creation honors `Idempotency-Key`.
6. **Identity and async.** The Cognito app client must not be able to write `custom:tenant_id` or `custom:role`. Every asynchronous flow has a DLQ with an alarm.
7. **Personal data.** Only name, email and phone are stored. No personal data in logs.

## How to work

- Write acceptance criteria before code. Add tests with every change: unit, integration, and a cross-tenant negative test where it applies.
- A change is done when its criteria are met, tests pass, `api/openapi.yaml` is updated, infrastructure is in code and the docs are current.
- Update the affected component README, `CHANGELOG.md` (under `[Unreleased]`) and this file in the same change that makes them out of date. Do not rewrite unrelated docs. Component READMEs explain how to run, test and deploy that component.
- Make the smallest change that satisfies the story. Do not add features, abstractions or configuration that no story needs.
- If a requirement is ambiguous, ask.
- Record every significant, hard-to-reverse decision as an ADR in `docs/adr/NNNN-short-title.md` (tenancy model, data model, authentication flow, a new AWS service, a change to the tooling list below). Use the sections Status, Context, Decision and Consequences, and keep it to about one page. A new ADR starts as `Proposed`. Set it to `Accepted` only after the owner explicitly approves it in the chat; never accept an ADR on your own. ADRs contain no account ids and no personal details.
- Never rewrite an accepted ADR. To change a decision, add a new ADR and set the old one's status to `Superseded by NNNN`. Fixing a typo is fine. If a change would contradict an accepted ADR, stop and ask first.
- Use Conventional Commits. Do not commit or push unless asked.
- Repository content (code, comments, docs, commit messages) is English, whatever language the chat uses. Comment only where the reason is non-obvious.

## Safety

- `terraform plan` is fine. Never run `terraform apply`, `terraform destroy` or anything else that creates, changes or deletes cloud resources, or costs money, without explicit confirmation.
- No secrets, credentials or account ids in files. Account and region come from variables. CI authenticates to AWS through OIDC.
- Never change account-level AWS settings (billing plan, organization, identity or Region settings) without explicit confirmation.
- Never ask the owner to paste credentials, keys or tokens into the chat, and never print or log them. AWS access uses the owner's short-lived CLI session; do not create or request long-lived access keys.
- Examples and `.env.example` files contain obviously fake placeholder values only. Terraform variables that hold secrets are `sensitive = true`; state lives in a private, encrypted, versioned S3 bucket.
- Once secret scanning (gitleaks) is set up, run it before proposing a commit. If a secret is ever committed, treat it as compromised: rotate it first, then clean the history.
- Do not copy code, text or diagrams from third-party or proprietary sources into the repository.

## Tooling (versions checked on 2026-10-16; change through an ADR)

Rule: use the newest stable line that AWS Lambda supports as generally available and that the rest of the toolchain supports. Prefer LTS to Current. Pin exact versions in the lockfile and re-check before upgrading.

- **Node.js 24**, the latest LTS line (Lambda runtime `nodejs24.x`, supported until April 2028). Not 22: an older LTS whose Lambda runtime is deprecated in April 2027. Not 26: it is the Current line and its Lambda runtime is in preview until about November 2026. npm workspaces come with Node.
- **TypeScript 6.0** in strict mode. TypeScript 7.0 is stable, but typescript-eslint does not support it yet (peer range below 6.1); revisit when it does.
- ESLint 10 with typescript-eslint 8, Prettier 3.
- Vitest 5, zod 4, AWS Lambda Powertools for TypeScript 2.x (logging, tracing, idempotency), esbuild 0.28 (pin the minor version; 0.x releases can break).
- Frontend: React 19, Vite 8.
- Infrastructure: Terraform 1.16, AWS provider 6.x.

## Commands

Run from the repository root (one npm workspace, see ADR-0004). Deploy scripts do not exist yet. When you add or change scripts, keep this list accurate.

- `npm install`: install all workspaces.
- `npm run lint`: ESLint (typescript-eslint strict, type-checked).
- `npm run format` / `npm run format:check`: Prettier (Markdown files are not covered).
- `npm run typecheck`: `tsc --noEmit` over the backend.
- `npm test`: Vitest (passes while there are no tests).
- `npm run build`: runs each workspace's own `build` script, if it has one.
