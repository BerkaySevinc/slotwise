# Tests

Cross-component tests: contract, concurrency, cross-tenant, smoke, regression and end-to-end. Unit tests live next to the code in `backend/` and `frontend/`. **Status:** `integration/` covers US-01 (`tenant-registration`) and US-03 (`services`) against a real DynamoDB table; `contract/` checks the handlers against the OpenAPI file; `helpers/` builds API Gateway events for the tests.

## Running the integration tests

They are skipped unless a table is named. After the dev stack is applied:

```
AWS_PROFILE=slotwise SLOTWISE_DATA_TABLE=slotwise-dev-data npm test
```

The tests write random slugs, user ids and tenant ids and delete what they created. It runs the repository code from the source tree against the real table; it does not call the deployed Lambda or API Gateway. It replaces Cognito with a fake, so it does not cover the Cognito call.

## Planned suites

| Suite | Purpose |
|---|---|
| Contract tests | Check API behavior against the OpenAPI contract in [`api/`](../api/) |
| Concurrency test | 50 parallel booking requests for the same slot must produce exactly one success |
| Cross-tenant tests | A user of one tenant can never read or change another tenant's data |
| Smoke suite | Fast check of the critical path after every deploy |
| Regression suite | Broader checks before a release |
| End-to-end | One Playwright test of the full booking flow |

Acceptance criteria for each story are written before implementation.
