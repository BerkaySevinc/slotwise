# US-04: Manage staff

As an owner, I manage the staff of my business and choose which services each of them performs.

Written before implementation. The contract is in [`api/openapi.yaml`](../../api/openapi.yaml). The item key `T#{tenantId}` / `STAFF#{staffId}` comes from [ADR-0002](../adr/0002-dynamodb-data-model-and-slot-locking.md). The endpoints join `catalog-api` and follow the conventions of [US-03](US-03-manage-services.md): ULID ids, retire instead of delete, tenant from the token only, `404` for another tenant's resource, paginated lists.

A staff member here is a **record** that appointments are assigned to, not a user account. Inviting staff so that they can sign in is a later story (US-07); the record can get a user id then without a migration.

## Acceptance criteria

### Create

- **AC-04.1** `POST /staff` takes a JSON object with exactly `name`. A missing, null, empty or malformed body returns `400 validation_failed`, never `500`.
- **AC-04.2** Any other property, in particular `tenantId`, `id`, `active`, `serviceIds`, `email` or `phone`, returns `400 validation_failed`. The server never uses a client-supplied tenant id, and no contact data is stored.
- **AC-04.3** `name` is trimmed and must be 1 to 80 characters. Two staff members of one tenant may have the same name.
- **AC-04.4** On success the call returns `201` with the staff member: a new ULID `id`, `name`, `active: true` and `createdAt`. The response contains no tenant id.
- **AC-04.5** `POST /staff` does not take an `Idempotency-Key`. A repeated call creates another staff member (decided: a duplicate is harmless and visible, and the owner can retire it). If the response is lost and the client retries, the owner ends up with two identical records. Revisit this if the endpoint gets a bulk or automated caller.
- **AC-04.6** A new tenant has no staff. Nothing creates a staff record automatically, not even for the owner: an owner who works in the chair adds themselves like any other member. The stories that offer booking must handle a tenant with no active staff (see "Handed to later stories").

### Read

- **AC-04.7** `GET /staff` returns the caller's active staff, ordered by id (creation order). `includeInactive=true` returns retired ones as well.
- **AC-04.8** The list is paginated exactly like the service list ([AC-03.9](US-03-manage-services.md)): `limit` (default 50, 1 to 100) and `nextToken`; the last page has no `nextToken`; a malformed token, or one not issued for the caller's tenant, returns `400 invalid_page_token`; the token never decides the tenant.
- **AC-04.9** `GET /staff/{staffId}` returns the staff member, active or not. A staff member of another tenant, or an unknown id, returns `404 not_found`.

### Update and retire

- **AC-04.10** `PATCH /staff/{staffId}` changes only the properties that are sent: `name`, `active`. An empty object, an unknown property or a value that breaks AC-04.3 returns `400`.
- **AC-04.11** `active: false` retires the staff member and `active: true` restores them. There is no delete endpoint. A retired member stays readable and keeps their id. Closing them to new bookings is enforced by the booking stories.
- **AC-04.12** Retiring a staff member changes no service and no appointment. What happens to their future appointments is decided in the appointment-management story (US-16), not here.
- **AC-04.13** A `PATCH` of a staff member of another tenant, or of an unknown id, returns `404 not_found` and changes nothing. The write is conditional on the item existing, so a race with nothing to update cannot create an item.

### Which services a staff member performs (extends US-03)

The link is stored on the service, as `staffIds`, because services change more often than staff. The staff endpoints have no `serviceIds`.

- **AC-04.14** `POST /services` and `PATCH /services/{serviceId}` accept an optional `staffIds`: an array of at most 50 distinct ids. A new service without it has no staff.
- **AC-04.15** Every id in `staffIds` must be a staff member of the caller's tenant, active or not. Anything else, including a staff member of another tenant and an unknown id, returns `400 validation_failed` with `field: staffIds` and `issue: unknown_staff`. The answer is the same for another tenant's id and for an invented one, so nothing leaks.
- **AC-04.16** On `PATCH`, `staffIds` replaces the whole set; `[]` empties it; leaving it out leaves the set unchanged. It is written in the same update as the other changed fields, so a partly applied patch is not possible.
- **AC-04.17** Every service response (`POST`, `GET` list, `GET` by id, `PATCH`) contains `staffIds`, an array that is `[]` when there is none. Services created before this story have none.
- **AC-04.18** Retiring or restoring a staff member never changes any service's `staffIds`. Readers that offer staff (availability, the public page) leave retired members out; those stories enforce it.

### Roles and tenant isolation

- **AC-04.19** `POST` and `PATCH` of staff, and any write of `staffIds`, require the role `owner`. `staff` gets `403 forbidden`. `GET` of staff accepts `owner` and `staff`. The role comes only from the verified token.
- **AC-04.20** A token without a tenant gets `403 tenant_required` on every route of `catalog-api`, the service routes and the staff routes, in one test that runs over all of them ([AC-02.4](US-02-sign-in-and-out.md)).
- **AC-04.21** The tenant id comes only from the verified token. Staff of tenant B are never returned, listed, changed or counted for tenant A, and tenant A cannot attach them to a service.

### Privacy

- **AC-04.22** Logs contain ids and error codes, never a staff name or a request body.

## Handed to later stories

These follow from the criteria above and are not implemented here:

- A tenant with no active staff cannot offer a booking. The public page and the availability story show "no appointments available" instead of an error or an empty picker (US-08, US-09).
- A retired staff member is left out of the public page, of availability and of "any staff" booking (US-08, US-09, US-10).
- The future appointments of a staff member who is retired (US-16).
- "Who performs this service" is read from the service. "Which services does this person perform" is a filter over the tenant's services, which are one key query and small by design. A bulk `PUT /staff/{id}/services` is added only if a screen needs it.

## Tests

- **Unit:** each validation rule (name boundaries and trimming, unknown properties, the `staffIds` limits of count and uniqueness), the PATCH rules, role checks, the page token for the staff list, the `staffIds` check with known, unknown and foreign ids, log content.
- **Integration (real dev table):** create, read, patch, retire and restore; the list across more than one page with `limit` and `includeInactive`; `staffIds` written, replaced, emptied and left alone; a service created before this story reads as having none; the `BatchGetItem` check against real items.
- **Cross-tenant negative tests (shared helper):** as tenant A, `GET` and `PATCH` of tenant B's staff return `404`, the list is empty of them, tenant B's item is unchanged, a page token of tenant B is refused, and tenant B's staff id in tenant A's `staffIds` returns `400 unknown_staff`.
- **Route-level tenant check (AC-04.20):** every route of `catalog-api` rejects a token without a tenant.
- **Contract:** the responses of the four staff endpoints, and the changed service responses, match `api/openapi.yaml`.

## Verification status

Checked on 2026-10-29 against the dev stack. "Unit" means in-memory repositories and a stubbed DynamoDB client; "integration" runs the handler and repositories against the real dev table (`tests/integration/staff.int.test.ts`, 8 tests, plus the 5 of `services.int.test.ts`); "end-to-end" is a manual run with a real Cognito user against the deployed API, 62 checks (the script was throwaway and is not in the repository); "contract" checks the handler's responses against `api/openapi.yaml`. The end-to-end run first showed 12 failures that were all `429` from the dev stage's throttle (5 requests per second); with the calls paced it passed in full.

| Criteria | Verified by | Status |
|---|---|---|
| AC-04.1, 04.2 | Unit, contract; end-to-end: malformed JSON, a null body, `{}`, an `email` and a `tenantId` return `400` | Verified |
| AC-04.3 | Unit (80 and 81 characters, trimming, empty and blank names, two members with one name) | Verified |
| AC-04.4 | Integration and end-to-end: `201`, `active: true`, no tenant id in the response | Verified |
| AC-04.5 | By design: no `Idempotency-Key` is read | Verified |
| AC-04.6 | By design: no code creates a staff record outside `POST /staff`; the "no active staff" handling belongs to the booking stories | Verified, handed over |
| AC-04.7, 04.8 | The list reads one item more than `limit` to decide whether a next page exists, so the last page never has a token (this fixed an empty last page found in the service list, see AC-03.9). Integration and end-to-end: pages of 2, the last page has no token, retired members are skipped without being counted, `includeInactive` returns all, a garbage token returns `400 invalid_page_token`, `limit=0` returns `400`. Integration: a token of tenant B is refused for tenant A | Verified |
| AC-04.9 | Integration and end-to-end: an unknown id returns `404`; a retired member is still readable | Verified |
| AC-04.10, 04.11 | Integration and end-to-end: rename, retire and restore; `{}` returns `400` | Verified |
| AC-04.12 | By design: no code touches services or appointments when a member is retired; the end-to-end run read the service link back after retiring | Verified |
| AC-04.13 | Integration and end-to-end: a patch of an unknown id returns `404` and the item is not created | Verified |
| AC-04.14, 04.15 | Integration and end-to-end: up to 12 ids (the batched check against real items), an unknown id, a duplicate, 51 ids and a non-array return `400`, with `unknown_staff` for unknown ids; a retired member is accepted. Integration: another tenant's member returns the same `unknown_staff`. The full 50 ids were not run against DynamoDB | Verified, except the full 50 |
| AC-04.16 | Integration and end-to-end: the set is replaced, left alone when `staffIds` is absent, and emptied (`REMOVE`) alone and together with another change; a patch with one unknown id changes nothing | Verified |
| AC-04.17 | Integration and end-to-end: every service response has `staffIds`; a service written before this story reads as `[]` | Verified |
| AC-04.18 | Unit, integration and end-to-end: retiring a member leaves the service's `staffIds` as it was | Verified |
| AC-04.19 | Unit, contract and integration: staff gets `403 forbidden` on every write and may read. Not tried with a real staff token (no staff user exists yet) | Partly verified |
| AC-04.20 | Unit, route-level test over all eight routes; end-to-end: a real token without a tenant gets `403 tenant_required` on all eight routes | Verified |
| AC-04.21 | Unit, contract and integration: tenant B gets `404` for tenant A's member on `GET` and `PATCH`, A's data is unchanged, the list of tenant B does not contain it, and A's member cannot be attached to B's service. Not tried with two real users | Verified |
| AC-04.22 | Unit test of everything the application logs. The real logs were not read | Partly verified |

## Choices to confirm

Decided with the owner before writing the criteria:

1. Staff are records, not user accounts. Invitations and sign-in are US-07.
2. Nothing creates a staff record automatically, not even for the owner.
3. The service-to-staff link is stored on the service as `staffIds`, because services change more often than staff. It is a DynamoDB string set, so adding or removing a member needs no read first. At most 50 ids.
4. Staff are retired with `active: false`, never deleted. The list shows active staff unless `includeInactive=true`. Future appointments of a retired member are decided in US-16.
5. A staff member has only `name` and `active` (plus `id` and `createdAt`): no email, phone, title or photo.
6. Four endpoints, the same pagination and the same roles as services, and no `Idempotency-Key` on `POST /staff`.
7. Any existing staff member can be attached to a service, active or not. `staffIds` on `PATCH` replaces the whole set and is left unchanged when absent.

Open while implementing:

8. In `api/openapi.yaml` the `Service` response lists `staffIds` as optional until the code returns it; the implementation makes it required (AC-04.17), so the contract tests never describe behavior the code does not have.
