# Tests

Cross-component tests: contract, concurrency, cross-tenant, smoke, regression and end-to-end. Unit tests live next to the code in `backend/` and `frontend/`. **Status: not started.**

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
