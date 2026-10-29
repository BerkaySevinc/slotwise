# Backend

TypeScript on Node.js, deployed as AWS Lambda functions. **Status:** `tenant-api` implements `POST /tenants` (US-01) and `catalog-api` the service and staff endpoints (US-03, US-04); the other planned functions are not started.

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

## catalog-api

The service and staff endpoints: create, list, get and change (retire or restore) a service ([US-03](../docs/requirements/US-03-manage-services.md)) or a staff member ([US-04](../docs/requirements/US-04-manage-staff.md)). One Lambda serves eight routes and dispatches on the route key. `src/` is grouped by feature, with the shared HTTP code in `http/`.

| File | Role |
|---|---|
| `src/handler.ts` | Wiring: environment, DynamoDB client, Powertools logger. Entry point of the bundle |
| `src/app.ts` | The router: the tenant check for every route, then the first feature that knows the route key, error mapping |
| `src/http/` | Shared HTTP code: responses and body parsing, the list query, the opaque `nextToken` (it carries the tenant so another tenant's token is refused) and the paginated DynamoDB query |
| `src/services/` | `routes.ts` (roles, parsing), `services.ts` (use cases, repository port, the duration plus buffer rule on merged values, the staff check), `service-schema.ts` (zod; stays here because only this function uses it), `dynamo-service-repository.ts` |
| `src/staff/` | The same four files for staff members; `dynamo-staff-repository.ts` also answers which ids are staff of a tenant, with one `BatchGetItem` |

Environment variable (set by Terraform): `DATA_TABLE`. Services are items `T#{tenantId}`/`SVC#{serviceId}`, staff `T#{tenantId}`/`STAFF#{staffId}`, both listed with a key query on their prefix (ADR-0002). Prices are integers in the smallest currency unit. Which staff perform a service is stored on the service as `staffIds`, a DynamoDB string set (no read is needed to add or remove a member, and the attribute is absent when the set is empty). The function never deletes: services and staff are retired with `active: false`. It logs ids and error codes only, never a name.

Test coverage: unit tests use in-memory repositories and a stubbed DynamoDB client. The queries, the pagination across retired items, the conditional update, the string set, the batched staff check and the cross-tenant cases run against the deployed table (`tests/integration/services.int.test.ts`, `tests/integration/staff.int.test.ts`); the responses are checked against `api/openapi.yaml` (`tests/contract/services.contract.test.ts`).

## Verify against dev before merging

Unit tests use fakes, so they cannot catch problems that only AWS shows. The first deployment of `tenant-api` found three: DynamoDB rejected the reserved word `timeZone` in an update expression, 13 of 50 parallel callers got `503` instead of `409` after transaction conflicts, and the ESM bundle failed at Lambda init with `Dynamic require of "node:https" is not supported`. None of them showed in unit tests. For a change that touches AWS:

1. `npm run build`. Each function's build also imports the finished bundle as an ES module, the way Lambda loads it, so a bundle that cannot start fails here. Do not test the bundle with `node -e` (it has a global `require` that hides this class of error).
2. `terraform plan` from `infra/envs/dev/`, then `apply` with the owner's confirmation, from the feature branch.
3. Run the integration tests against the dev tables: `SLOTWISE_DATA_TABLE=slotwise-dev-data npm test`.
4. Call the deployed API with a real token when the change involves Cognito or the authorizer.
5. Merge, so that `main` matches what is deployed.

## Conventions

- One Lambda is one folder under `functions/`; there is no folder per endpoint. When a function gets its second feature, group its `src/` by feature (`tenants/`, `branding/`), not by layer, and put shared HTTP helpers in `http/`.
- The HTTP layer calls the use case, the use case depends on interfaces (repository, user directory), and DynamoDB and Cognito are wired in `handler.ts`. Use-case code does not import the AWS SDK.
- Unit tests sit next to the code. Tests that span components live in the root `tests/` folder.
- `packages/shared` holds only code used by more than one function (or by the frontend); anything else stays in its function.
- `catalog-api` is the first function with several routes and several features: it dispatches on `routeKey` in `app.ts` (one integration, eight routes) and is grouped as `services/`, `staff/` and `http/`. It follows `tenant-api` in letting use-case code throw `ApiError`.
- Known gaps, fixed when `tenant-api` gets its second feature: use-case code throws `ApiError` (HTTP status codes) and should throw its own error types that an `http/` layer maps to responses; several routes in one Lambda need routing (dispatch on `routeKey`, or one integration per route); add an ESLint `no-restricted-imports` rule that keeps the AWS SDK out of use-case files.
- The tenant id always comes from the verified JWT, never from the request path or body.
- Handlers validate input at the boundary and return `400` for malformed or null bodies.
- Every authenticated endpoint has a cross-tenant negative test.