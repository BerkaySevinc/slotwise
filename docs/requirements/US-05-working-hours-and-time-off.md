# US-05: Working hours and time off

As an owner, I set the weekly working hours of each staff member and enter their time off (holidays, sick days), so that availability only offers times when the person works.

Written before implementation. The contract is in [`api/openapi.yaml`](../../api/openapi.yaml). The item keys `T#{tenantId}` / `HOURS#{staffId}` and `OFF#{staffId}#{date}` come from [ADR-0002](../adr/0002-dynamodb-data-model-and-slot-locking.md). The endpoints join `catalog-api` and follow the conventions of [US-03](US-03-manage-services.md) and [US-04](US-04-manage-staff.md): tenant from the token only, `404` for another tenant's resource, paginated lists, roles from the token.

This story stores the rules. It computes no availability: turning hours and time off into bookable slots is US-09.

## Acceptance criteria

### Weekly working hours

- **AC-05.1** `PUT /staff/{staffId}/hours` replaces the whole week of a staff member. The body is an object whose properties are the days `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`; each value is an array of intervals `{start, end}`. A day that is left out, or `[]`, means the person does not work that day. A missing, null, empty (`{}` is valid and means no hours at all) or malformed body returns `400 validation_failed`, never `500`. Any other property returns `400`.
- **AC-05.2** Times are `HH:MM` on a 24-hour clock. `start` is `00:00` to `23:55` and `end` is `00:05` to `24:00`; `24:00` is the end of the day. Both are multiples of 5 minutes (the lock grid, rule 3), otherwise `400` with `issue: not_a_multiple`; a value that is not `HH:MM` gets `issue: invalid_format`.
- **AC-05.3** Within a day, `start` is before `end` (`issue: end_not_after_start`), intervals are in increasing order and neither overlap nor touch (`issue: overlapping`), and there are at most 4 intervals (`issue: too_many`). A lunch break is the gap between two intervals. An interval never crosses midnight: a shift from 22:00 to 02:00 is written as `22:00–24:00` on one day and `00:00–02:00` on the next.
- **AC-05.4** Times are the business's **local wall-clock time**, not UTC. `09:00` is 09:00 in the tenant's IANA time zone on every day of the year, also on the days the clocks change. Nothing here converts to UTC; availability does that for a concrete date (US-09). If the tenant's time zone is changed later, the stored times stay as they are.
- **AC-05.5** The write is one conditional put in the same transaction as a check that the staff member exists. A staff member of another tenant, or an unknown id, returns `404 not_found` and nothing is written. The whole week is stored in one item, so a partly applied week is not possible. Two simultaneous `PUT`s: the last one wins (decided: one owner edits one form).
- **AC-05.6** On success `PUT` returns `200` with the week as stored: all seven days, `[]` for the days without hours.
- **AC-05.7** `GET /staff/{staffId}/hours` returns the same shape. A staff member whose hours were never set returns `200` with seven empty days, not `404`: **a new staff member has no working hours**, so nobody can book them until the owner sets them. Unknown or foreign staff id: `404`.

### Time off

- **AC-05.8** `POST /staff/{staffId}/time-off` takes exactly `startDate` and `endDate`, calendar dates `YYYY-MM-DD` in the business's local time, both inclusive. The dates must exist (`2026-02-30` is `invalid_format`), `endDate` is not before `startDate` (`end_before_start`), and the range is at most 31 days (`too_large`). Time off is for whole days. Any other property, in particular a reason or note, returns `400`.
- **AC-05.9** Each day of the range becomes one item, written in one transaction together with the check that the staff member exists. All days are written or none. A day that is already time off is simply written again, so repeating the same request is safe and returns the same result. A staff member of another tenant, or an unknown id, returns `404`.
- **AC-05.10** `POST` returns `201` with `items`: the dates of the range, in order. Time off in the past is accepted: nothing depends on "today", and availability ignores past days.
- **AC-05.11** `GET /staff/{staffId}/time-off` lists the dates of that staff member in ascending order, paginated like the other lists (`limit` default 50, 1 to 100, `nextToken`, the last page has no token, a bad or foreign token returns `400 invalid_page_token`). The optional `fromDate` returns only that date and later, so a screen can ask for upcoming time off.
- **AC-05.12** `DELETE /staff/{staffId}/time-off/{date}` removes one day and returns `204`. A date that is not time off also returns `204`, so repeating the call is safe. A malformed date returns `400`. An unknown or foreign staff id returns `404`, checked first.
- **AC-05.13** Hours and time off are kept for a retired staff member and can be read and changed (US-04): restoring the person does not lose them.

### Roles and tenant isolation

- **AC-05.14** `PUT` hours, `POST` and `DELETE` time off require the role `owner`; `staff` gets `403 forbidden`. `GET` hours and `GET` time off accept `owner` and `staff`. The role comes only from the verified token. Staff users editing their own hours are not part of this story (US-07).
- **AC-05.15** A token without a tenant gets `403 tenant_required` on every route of `catalog-api`, including the five new ones, in the existing route-level test.
- **AC-05.16** The tenant id comes only from the verified token. As tenant A, every one of the five routes on a staff member of tenant B returns `404`, reads nothing and changes nothing; a time-off page token of tenant B is refused.

### Privacy

- **AC-05.17** No reason is stored with time off. A sick day is health information, and only name, email and phone are stored (rule 7); the owner knows the reason without the system holding it.
- **AC-05.18** Logs contain ids and error codes, never a request body or a date range.

## Handed to later stories

These follow from the criteria above and are not implemented here:

- Availability (US-09) turns the hours of a concrete date into UTC with the tenant's time zone, subtracts time off and existing appointments, and decides what to do with a local time that does not exist (spring forward) or happens twice (fall back). Tests with `Europe/Istanbul` and one DST zone belong there.
- A staff member without hours has no slots; the public page shows "no appointments available" instead of an error (US-08, US-09).
- What happens to appointments that already exist on a day that becomes time off, or outside new hours, is decided in appointment management (US-16). This story does not look at appointments.
- Staff users editing their own hours and time off (US-07).
- Time off for part of a day, a business-wide closing day, and one-off changes to one date's hours are not needed by any story. They can be added later as optional fields without changing stored items.

## Tests

- **Unit:** every rule of the hours body (times, grid, order, overlap, touching, 4 intervals, unknown day, null and malformed bodies, an empty object), the date-range rules (leap day, invalid dates, 31 and 32 days, `endDate` before `startDate`, unknown property), the shape returned for a week that was never set, role checks, page tokens, log content.
- **Integration (real dev table):** `PUT` then `GET` the same week; a second `PUT` replaces it; the empty default; a range of 31 days written in one transaction and listed over several pages; `fromDate`; the same range posted twice; `DELETE` of a day and of a day that is not time off; the existence check inside the transaction (an unknown staff id writes nothing); a retired member keeps and accepts both.
- **Cross-tenant negative tests (shared helper):** as tenant A, all five routes on tenant B's staff member return `404`, and tenant B's hours and time off are unchanged; a time-off page token of tenant B is refused.
- **Route-level tenant check (AC-05.15):** every route of `catalog-api` rejects a token without a tenant.
- **Contract:** the responses of the five endpoints match `api/openapi.yaml`.

## Choices to confirm

Decided with the owner before writing the criteria:

1. A week is a list of zero to four intervals per day. A lunch break is the gap between two intervals.
2. One item per staff member holds the whole week; `PUT` replaces it. There are no per-day endpoints.
3. Times are multiples of 5 minutes, `HH:MM`, and the end of the day is `24:00`.
4. Time off is whole days, entered as a date range of at most 31 days, stored one item per day. Part-day time off is a later optional extension.
5. No interval crosses midnight; a night shift is written as two parts.
6. Hours and dates are the business's local wall-clock time and local calendar dates, never UTC.
7. Five endpoints; only the owner writes; staff may read; re-posting existing time off is safe; time off in the past is allowed; retired staff keep hours and time off.
8. A staff member with no hours set has an empty week and cannot be booked.

Changed while writing the criteria:

9. Time off has **no note or reason** field, although the owner first asked for time-off entries that update a note on a repeated day. A reason such as "sick" is health data and rule 7 allows only name, email and phone. Repeating a day is therefore a plain rewrite of the same item.

Open while implementing:

10. The `catalog-api` role needs `DeleteItem`, the first delete permission of the service, and the permission that lets `TransactWriteItems` carry a condition check. Both are confirmed at the dev apply, not assumed.
11. Verification status is added to this file when the code is done.
