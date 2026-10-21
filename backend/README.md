# Backend

TypeScript on Node.js, deployed as AWS Lambda functions. **Status:** `tenant-api` implements `POST /tenants` (US-01); the other planned functions are not started.

## Planned functions

| Function | Responsibility |
|---|---|
| `tenant-api` | Onboarding, branding, users and invitations |
| `catalog-api` | Services, staff, working hours, time off |
| `availability-api` | Read-only slot computation |
| `booking-api` | Create, cancel and update appointments; owns locking and idempotency |
| `notification-worker` | Consumes the SQS queue and sends email through SES |
| `report-worker` | Weekly summary email per tenant |

## Layout

```
backend/
├── functions/<name>/     one folder per Lambda function
└── packages/shared/      tenant-aware authorization, validation, logging, DynamoDB key helpers
```

## Commands

The backend is part of the npm workspace at the repository root. Run `npm install`, `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` from the root. Unit tests are `*.test.ts` files next to the code. Functions import shared code as `@slotwise/shared`.

Each function's `build` script bundles it with esbuild into `dist/index.mjs`; Terraform zips that file when it deploys.

## tenant-api

`POST /tenants` creates the signed-in user's business ([US-01](../docs/requirements/US-01-register-business.md), [ADR-0007](../docs/adr/0007-owner-registration-and-sign-in.md)).

| File | Role |
|---|---|
| `src/handler.ts` | Wiring: reads the environment, creates AWS clients, Powertools logger, metrics and idempotency. Entry point of the bundle |
| `src/app.ts` | HTTP layer: auth claims, `Idempotency-Key`, body parsing, error mapping |
| `src/create-tenant.ts` | The use case (ports for the repository and for Cognito), including provisioning recovery |
| `src/dynamo-tenant-repository.ts` | DynamoDB: the registration transaction and cancellation-reason mapping |

Environment variables (set by Terraform): `DATA_TABLE`, `IDEMPOTENCY_TABLE`, `USER_POOL_ID`. The function logs ids and error codes only, never the body, email or business name. It emits the metric `ProvisioningIncomplete` (namespace `Slotwise`, dimension `service=tenant-api`).

Items written by the registration transaction (keys are built only in `packages/shared/src/keys.ts`): tenant profile `T#{id}`/`PROFILE`, settings `T#{id}`/`SETTINGS`, slug `SLUG#{slug}`/`SLUG`, owner lookup `OWNER#{userId}`/`OWNER`. The settings and owner items are not in the ADR-0002 table; see the US-01 requirements.

Test coverage: unit tests use an in-memory repository and a stubbed DynamoDB client, so they prove the logic and the mapping of DynamoDB's cancellation reasons, not DynamoDB itself. Transaction atomicity and the 50-parallel-request slug test run against the deployed table (see [`tests/`](../tests/README.md)). The Cognito call and the API Gateway authorizer are verified by hand after a deploy.

## Conventions

- One Lambda is one folder under `functions/`; there is no folder per endpoint. When a function gets its second feature, group its `src/` by feature (`tenants/`, `branding/`), not by layer, and put shared HTTP helpers in `http/`.
- The HTTP layer calls the use case, the use case depends on interfaces (repository, user directory), and DynamoDB and Cognito are wired in `handler.ts`. Use-case code does not import the AWS SDK.
- Unit tests sit next to the code. Tests that span components live in the root `tests/` folder.
- `packages/shared` holds only code used by more than one function (or by the frontend); anything else stays in its function.
- Known gaps, fixed when `tenant-api` gets its second feature: use-case code throws `ApiError` (HTTP status codes) and should throw its own error types that an `http/` layer maps to responses; several routes in one Lambda need routing (dispatch on `routeKey`, or one integration per route); add an ESLint `no-restricted-imports` rule that keeps the AWS SDK out of use-case files.
- The tenant id always comes from the verified JWT, never from the request path or body.
- Handlers validate input at the boundary and return `400` for malformed or null bodies.
- Every authenticated endpoint has a cross-tenant negative test.