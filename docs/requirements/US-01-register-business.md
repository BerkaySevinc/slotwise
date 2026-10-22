# US-01: Register a business

As an owner, I register my business and get a unique booking page slug.

Written before implementation. Design background is in [ADR-0007](../adr/0007-owner-registration-and-sign-in.md); the contract is in [`api/openapi.yaml`](../../api/openapi.yaml). Registration is two steps: the owner signs up and verifies the email with Cognito ([US-02](US-02-sign-in-and-out.md)), then calls `POST /tenants`.

## Acceptance criteria

### Input

- **AC-01.1** The body must be a JSON object with exactly `name`, `slug` and `timeZone`. A missing, null, empty or malformed body returns `400 validation_failed`, never `500`.
- **AC-01.2** Any other property, in particular `tenantId`, `ownerId` or `role`, returns `400 validation_failed`. The server never uses a client-supplied tenant id, owner or role.
- **AC-01.3** `name` is trimmed and must be 1 to 100 characters.
- **AC-01.4** `slug` is 3 to 30 characters of lowercase letters, digits and hyphens, with no leading, trailing or double hyphen. Reserved words return `400 validation_failed` with `issue: reserved`. The list lives in one place in the shared package; it starts with `admin`, `api`, `app`, `auth`, `login`, `logout`, `signup`, `register`, `www`, `public`, `static`, `assets`, `docs`, `help`, `support`, `status`, `billing`, `dashboard`, `settings`.
- **AC-01.5** `timeZone` must be an IANA time zone known to the runtime; anything else returns `400`. `Europe/Istanbul` and a DST zone such as `Europe/Berlin` are accepted.
- **AC-01.6** `Idempotency-Key` is required (8 to 128 characters); without it the call returns `400`.

### Result

- **AC-01.7** On success the call returns `201` with the tenant: a new ULID `id`, `status: active`, and the stored `name`, `slug`, `timeZone`, `createdAt`.
- **AC-01.8** One DynamoDB transaction writes the tenant profile (`provisioning`), the default settings, the slug item and the owner lookup item. If any condition fails, none of them exist afterwards.
- **AC-01.9** Default settings follow the specification: slot granularity 15 minutes, minimum lead time 2 hours, booking window 60 days, cancellation cutoff 24 hours.
- **AC-01.10** After the transaction the owner's Cognito user gets `custom:tenant_id` (the new id) and `custom:role = owner`, then the tenant becomes `active`. The user id comes from the verified token only.

### Slug uniqueness

- **AC-01.11** A slug that is already used by any tenant, in any state, returns `409 slug_taken` and creates nothing.
- **AC-01.12** 50 parallel requests from 50 different users for the same slug produce exactly one `201`; all others get `409 slug_taken`.
- **AC-01.13** Whether a slug is free is decided only by the conditional write, never by a read before it.

### One tenant per user, retries and recovery

- **AC-01.14** The owner lookup item (written only if it does not exist) makes a second tenant for the same user impossible. A caller who already owns an `active` tenant gets `409 tenant_already_exists`.
- **AC-01.15** A repeated request with the same `Idempotency-Key` and the same body returns the original response without creating anything. The same key with a different body returns `422 idempotency_key_mismatch`.
- **AC-01.16** If the Cognito step fails, the call returns `503 provisioning_incomplete`; the tenant stays `provisioning`, a metric is emitted and its alarm is configured. No data is lost.
- **AC-01.17** A new call (any key) by the same user while the tenant is `provisioning` completes it and returns `201`. If that call carries a different slug, the old slug item is replaced in one transaction; if the new slug is taken the call returns `409 slug_taken` and the old slug is kept. After `active`, the slug cannot be changed.

### Visibility and privacy

- **AC-01.18** A `provisioning` tenant is not reachable from public endpoints. This is tested in the first story that adds a public tenant endpoint (US-08).
- **AC-01.19** Logs contain ids and error codes, never the request body, the owner's email or the business name.

## Tests

- **Unit:** input validation (each rule above, including the slug and time zone cases), reserved-word list, default settings, key builders for the tenant, slug and owner items, idempotency handling.
- **Integration (DynamoDB Local or the dev stack):** the registration transaction commits all four items or none; duplicate slug returns `409`; a second tenant for one user returns `409`; the Cognito-failure path leaves a `provisioning` tenant and a repeated call completes it; changing the slug while `provisioning`.
- **Concurrency:** the 50-parallel-request slug test (AC-01.12).
- **Cross-tenant negative tests:** `POST /tenants` takes no tenant id, so the case that applies is AC-01.2: a tenant id, owner or role in the body is rejected and never used. The reusable cross-tenant test helper, "request as tenant A for a resource of tenant B returns `404`", is added with the first story that has a tenant resource.
- **Contract:** the responses of `POST /tenants` match `api/openapi.yaml`.

## Verification status

Checked on 2026-10-22 against the dev stack. "Unit" means fakes only; "integration" runs the repository code against the real dev table (`tests/integration/`); "end-to-end" is a manual run with a real Cognito user against the deployed API (the script was throwaway and is not in the repository).

| Criteria | Verified by | Status |
|---|---|---|
| AC-01.1, 01.2 | Unit, contract; end-to-end: malformed JSON and an unknown property return `400` | Verified |
| AC-01.3, 01.4, 01.5 | Unit (slug, reserved words, `Europe/Istanbul` and `Europe/Berlin`) | Verified |
| AC-01.6 | Unit; end-to-end: a missing key returns `400` | Verified |
| AC-01.7, 01.10 | End-to-end: `201`, and after a token refresh the ID token carries `custom:tenant_id` and `custom:role = owner` | Verified |
| AC-01.8, 01.9 | Integration: all four items exist, the loser of a conflict leaves nothing, the settings item holds the defaults | Verified |
| AC-01.11, 01.12 | Integration: duplicate slug returns `409`; 50 parallel requests give exactly 1 success and 49 `slug_taken` (repeated runs) | Verified |
| AC-01.13 | By design and review: the slug is decided by the conditional write. After a cancelled transaction the repository reads the slug item only to classify the failure | Verified |
| AC-01.14, 01.15 | Integration: a second tenant returns `409 tenant_already_exists`. End-to-end: the same key and body replays the `201`, the same key with another body returns `422`, a new key returns `409` | Verified |
| AC-01.16 | Integration with a fake Cognito failure: the tenant stays `provisioning` and a repeated call completes it. The `503`, the metric and the alarm were not triggered against the real Cognito or CloudWatch | Partly verified |
| AC-01.17 | Integration: the slug is replaced in one transaction while `provisioning` (this found the `timeZone` reserved-word bug) | Verified |
| AC-01.18 | Waits for the first public endpoint (US-08) | Open |
| AC-01.19 | Unit test of everything the application logs; the real logs of the end-to-end run contain no email, business name, slug or time zone, only `tenant active` and the tenant id. The error paths were not exercised against the real logger | Partly verified |

## Choices to confirm

These were chosen while writing the criteria and are open to change before implementation:

1. A caller who already owns an `active` tenant gets `409 tenant_already_exists` (AC-01.14) instead of the existing tenant.
2. The same `Idempotency-Key` with a different body returns `422` (AC-01.15).
3. Properties other than the three allowed ones are rejected rather than ignored (AC-01.2).
4. The starting list of reserved slugs (AC-01.4).
5. The owner lookup item is the one key that does not start with a tenant id (its key is defined with the key builders), like the slug lookup in ADR-0002.

Decided while implementing:

6. The default settings are stored as their own item (`T#{id}` / `SETTINGS`). ADR-0002's table does not list this item type; it follows the same tenant-prefixed key rule, so no new ADR is needed. The owner lookup item (`OWNER#{userId}` / `OWNER`) is likewise new to that table.
7. Clients send the Cognito **ID token** to the API, because only it carries `custom:tenant_id` and `custom:role`. The authorizer checks issuer and audience (the app client id).
8. `timeZone` must have the `Area/Location` form and be known to the runtime; it is stored in canonical spelling. Offsets and abbreviations are rejected.
9. Idempotency compares the validated request in canonical form (so whitespace and key order do not matter) and is scoped to the user: the same key from two users never collides. A request with the same key that is still running returns `409 request_in_progress`. Records live 24 hours. Failed calls (409, 503) leave no record, so repeating them runs again.
10. If DynamoDB keeps cancelling the registration transaction because of concurrent writes, the call returns `503 try_again` after a few short retries.
11. A repeated call during `provisioning` also updates the name and time zone, not only the slug.
12. The alarm for `provisioning_incomplete` has no notification target yet (no SNS topic exists); its state is visible in CloudWatch.
