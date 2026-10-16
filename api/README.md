# API

The OpenAPI contract (`openapi.yaml`) shared by the backend and the frontend. **Status: not started.**

## How it is used

- Written before the handlers. Handlers and contract tests (see [`tests/`](../tests/)) are checked against it.
- The frontend API client is generated from it.
- Swagger UI is published with the demo.

## Conventions

- Cursor-based pagination.
- `400` for malformed or null request bodies, `409` for slot conflicts.
- One error body format with a machine-readable code.
- `Idempotency-Key` header on booking creation.
