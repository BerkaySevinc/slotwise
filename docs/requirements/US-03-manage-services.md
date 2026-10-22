# US-03: Manage services

As an owner, I define my services with a name, a duration, a price and an optional buffer, and I can change or retire them.

Written before implementation. The contract is in [`api/openapi.yaml`](../../api/openapi.yaml). The item key `T#{tenantId}` / `SVC#{serviceId}` and the 480 minute cap on duration plus buffer come from [ADR-0002](../adr/0002-dynamodb-data-model-and-slot-locking.md). This is the first story with a tenant resource and the first with a second authenticated endpoint, so it also adds the reusable cross-tenant test helper and the route-level check of [AC-02.4](US-02-sign-in-and-out.md).

## Acceptance criteria

### Create

- **AC-03.1** `POST /services` takes a JSON object with `name`, `durationMinutes` and `priceMinor`, and optionally `bufferMinutes` (default 0). A missing, null, empty or malformed body returns `400 validation_failed`, never `500`.
- **AC-03.2** Any other property, in particular `tenantId`, `id`, `active` or `currency`, returns `400 validation_failed`. The server never uses a client-supplied tenant id.
- **AC-03.3** `name` is trimmed and must be 1 to 80 characters. Two services of one tenant may have the same name.
- **AC-03.4** `durationMinutes` is an integer from 5 to 480 and a multiple of 5. `bufferMinutes` is an integer from 0 to 60 and a multiple of 5. Their sum is at most 480 (ADR-0002: the locks of one appointment must fit one transaction).
- **AC-03.5** `priceMinor` is a non-negative integer in the smallest unit of the tenant's currency (kuruş for TRY), at most 100000000. `0` is allowed (a free service). Decimals and strings are rejected.
- **AC-03.6** On success the call returns `201` with the service: a new ULID `id`, `active: true`, the stored fields and `createdAt`. The response contains no tenant id.
- **AC-03.7** `POST /services` does not take an `Idempotency-Key`. A repeated call creates another service (decided: a duplicate is harmless and visible, and the owner can retire it). If the response is lost and the client retries, the owner ends up with two identical services. Revisit this if the endpoint gets a bulk or automated caller.

### Read

- **AC-03.8** `GET /services` returns the caller's active services, ordered by id (creation order). `includeInactive=true` returns inactive ones as well.
- **AC-03.9** The list is paginated: `limit` (default 50, 1 to 100) and `nextToken`. The last page has no `nextToken`. A token that is malformed, or that was not issued for the caller's tenant, returns `400 invalid_page_token`. The token never decides the tenant: the key condition is always built from the verified token's tenant id.
- **AC-03.10** `GET /services/{serviceId}` returns the service, active or not. A service of another tenant, or an unknown id, returns `404 not_found`.

### Update and retire

- **AC-03.11** `PATCH /services/{serviceId}` changes only the properties that are sent: `name`, `durationMinutes`, `bufferMinutes`, `priceMinor`, `active`. An empty object, an unknown property or a value that breaks AC-03.3 to AC-03.5 returns `400`. The duration plus buffer rule is checked on the resulting values, not only on the sent ones.
- **AC-03.12** `active: false` retires the service and `active: true` restores it. There is no delete endpoint. A retired service stays readable and keeps its id. Closing it to new bookings is enforced by the booking stories.
- **AC-03.13** A `PATCH` of a service of another tenant, or of an unknown id, returns `404 not_found` and changes nothing. The write is conditional on the item existing, so a race with nothing to update cannot create an item.
- **AC-03.14** Changing a service never changes appointments that already exist: they hold a snapshot of name, duration and price (CLAUDE.md rule 2).

### Currency

- **AC-03.15** The tenant settings item has a `currency` (ISO 4217 code), `TRY` for new tenants. Settings that were written before this story have no `currency` and are read as `TRY`. `GET /services` and `GET /services/{serviceId}` do not repeat it; clients take it from the tenant settings, and the appointment stories snapshot it.

### Roles and tenant isolation

- **AC-03.16** `POST` and `PATCH` require the role `owner`. `staff` gets `403 forbidden`. `GET` accepts `owner` and `staff`. The role comes only from the verified token (a shared `requireRole` helper).
- **AC-03.17** A token without a tenant gets `403 tenant_required` on all four endpoints (AC-02.4, now covered by a test that runs over every authenticated route).
- **AC-03.18** The tenant id comes only from the verified token. A service of tenant B is never returned, listed, changed or counted for tenant A.

### Privacy

- **AC-03.19** Logs contain ids and error codes, never the service name or the request body.

## Tests

- **Unit:** each validation rule (boundaries 5, 480, 60, the sum rule, multiples of 5, price type and range), the PATCH merge (the sum rule on merged values), role checks, the page token codec (malformed, wrong tenant), default currency on old settings, log content.
- **Integration (real dev table):** create then read, patch with a condition on a missing item, retire and restore, listing across more than one page with `limit` and `includeInactive`, a token from another tenant.
- **Cross-tenant negative tests (shared helper, new):** as tenant A, `GET`, `PATCH` and list for a service of tenant B return `404` or an empty page, and tenant B's item is unchanged. A page token issued for tenant B is rejected for tenant A.
- **Route-level tenant check (AC-02.4, AC-03.17):** every authenticated route rejects a tenantless token with `403 tenant_required`.
- **Contract:** the responses of the four endpoints match `api/openapi.yaml`.

## Verification status

Not implemented yet.

## Choices to confirm

Decided with the owner before writing the criteria:

1. Prices are integers in the smallest currency unit (`priceMinor`); the currency is one per tenant and lives in the settings, added now with the default `TRY`.
2. Duration 5 to 480 and buffer 0 to 60, both multiples of 5, the sum at most 480.
3. Services are retired with `active: false`, never deleted. The list shows active services unless `includeInactive=true`.
4. The list is paginated with `limit` (default 50, maximum 100) and `nextToken`.
5. Names are not unique.
6. Only the owner writes; staff read.
7. Four endpoints; `PATCH` is partial; `POST /services` has no `Idempotency-Key`.

Open while implementing:

8. How `bufferMinutes` is used when computing availability is decided by the availability story; this story only stores and validates it.
