# ADR-0002: DynamoDB data model and slot locking

## Status

Accepted

## Context

Application data lives in DynamoDB. The access patterns are known (below) and overlap between appointments of one staff member must be impossible even under concurrent requests. DynamoDB has no interval-overlap constraint, so the guarantee has to come from conditional writes.

## Decision

### Single table, generic key names

One table with `PK` and `SK` (strings) and four global secondary indexes. On-demand capacity, point-in-time recovery on, TTL attribute `expiresAt`. Key values start with the tenant id (see ADR-0001) except the slug and cancellation-token lookups.

| Item | PK | SK |
|---|---|---|
| Tenant profile | `T#{tenantId}` | `PROFILE` |
| Slug lookup | `SLUG#{slug}` | `SLUG` |
| Service | `T#{tenantId}` | `SVC#{serviceId}` |
| Staff | `T#{tenantId}` | `STAFF#{staffId}` |
| Working hours | `T#{tenantId}` | `HOURS#{staffId}` |
| Time off | `T#{tenantId}` | `OFF#{staffId}#{date}` |
| Customer | `T#{tenantId}` | `CUST#{customerId}` |
| Appointment | `T#{tenantId}` | `APPT#{apptId}` |
| Slot lock | `T#{tenantId}#STAFF#{staffId}` | `LOCK#{slotStartUtc}` |

IDs are ULIDs. `slotStartUtc` is a fixed-width UTC timestamp (`yyyyMMddTHHmmssZ`) so range queries sort correctly. The slug item is written with `attribute_not_exists(PK)` in the same transaction that creates the tenant profile, which makes slugs unique.

### Global secondary indexes

| Index | Partition key | Sort key | Projection | Serves |
|---|---|---|---|---|
| GSI1 | `T#{tenantId}#DAY#{localDate}` | `{startUtc}#{apptId}` | all | Appointments of a tenant for a day or week (one query per day) |
| GSI2 | `T#{tenantId}#STAFF#{staffId}` | `{startUtc}#{apptId}` | all | Appointments of one staff member in a range |
| GSI3 | `T#{tenantId}#EMAIL#{sha256(normalizedEmail)}` | `{startUtc}#{apptId}` | all | Appointments of one customer |
| GSI4 | `TOKEN#{cancellationTokenHash}` | none | keys only | Appointment by cancellation token (sparse) |

Only appointment items carry GSI attributes. `localDate` is the appointment start in the tenant's time zone at booking time and is not recomputed if the tenant later changes zone. The email in GSI3 is hashed so that no personal data appears in keys, which show up in logs and error messages. GSI4 is sparse: the attributes are removed when the token is used or the appointment is cancelled.

### Access patterns

1. Tenant by slug: get `SLUG#{slug}`, then the profile.
2. Services and staff of a tenant: query `PK = T#{tenantId}` with an `SVC#` or `STAFF#` prefix.
3. Slots taken for a staff member on a day: query the lock partition by `SK` range.
4. Tenant appointments for a day or week: GSI1.
5. Staff appointments in a range: GSI2.
6. Customer appointments: GSI3.
7. Appointment by cancellation token: GSI4, then read the item.

### Slot locking

- Locks are written on a **fixed 5-minute grid**, independent of the tenant's slot granularity, which only decides which start times are offered. Changing granularity never invalidates existing locks. Start times must fall on the grid.
- A booking is one `TransactWriteItems` with the appointment `Put` and one lock `Put` per 5-minute slot from `start` to `end + buffer`. Every lock has `attribute_not_exists(PK)`. If any slot is taken, the whole transaction fails and the API returns `409`.
- A cancellation is one transaction that deletes the locks and updates the appointment status.
- A transaction holds at most 100 items, so duration plus buffer is capped at 480 minutes (96 locks plus the appointment). The service validation enforces this.
- Locks carry `expiresAt` (end of the occupied time plus one day) so TTL removes locks of finished appointments.
- Availability reads working hours, time off and locks for the requested day and returns the free grid slots.
- Booking creation honors `Idempotency-Key`, using the Powertools idempotency utility with its own table, so a retried request returns the original result instead of a conflict.
- Required test: 50 parallel requests for the same slot produce exactly one success.

## Consequences

- Overlap prevention is a database guarantee, not an application check.
- Appointments are written to four places (table plus three indexes) and a booking costs one transaction of up to 97 items. At small-business volume this is cheap.
- Keys are generic (`PK`/`SK`) and meaning lives in the key builders of the shared package, which must be the only place that builds keys.
- A tenant that changes time zone keeps old appointments under the old `localDate`; day views for past days may be off by a day for those rows. Accepted for the MVP.
- Platform-wide listings (admin tenant list, weekly reports) need an enumeration strategy for tenants. This is decided with the `report-worker` story, with a likely sparse GSI on tenant profile items.

## Alternatives considered

- **Application-level overlap check only:** races under concurrency; rejected.
- **One lock per appointment with a range:** DynamoDB cannot enforce interval overlap on a single item.
- **Locks on the tenant's granularity:** changing granularity would invalidate existing locks; rejected in favor of the fixed grid.
- **A relational database:** exclusion constraints solve overlap natively, but cost and operations do not fit the serverless, near-zero idle cost goal.
