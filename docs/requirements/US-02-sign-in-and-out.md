# US-02: Sign in and out

As an owner or staff member, I log in and out securely.

Written before implementation. Design background is in [ADR-0007](../adr/0007-owner-registration-and-sign-in.md). Sign-in and sign-out are Cognito features; the API only validates tokens, so most criteria below are checks on the user pool configuration and on the API's token handling. The first sign-in comes after the sign-up described in [US-01](US-01-register-business.md).

## Acceptance criteria

- **AC-02.1** A user must verify the email with the code before the first sign-in. An unverified user cannot obtain tokens.
- **AC-02.2** The API has no login or registration endpoint; none appears in [`api/openapi.yaml`](../../api/openapi.yaml).
- **AC-02.3** Every authenticated endpoint rejects a missing, malformed, expired or wrongly signed token with `401`.
- **AC-02.4** A valid token without `custom:tenant_id` is accepted only by `POST /tenants`. Every other authenticated endpoint returns `403 tenant_required`. This is one shared check, covered by a test that runs against every authenticated route.
- **AC-02.5** The tenant id and role used by any handler come from the verified token claims only. The app client cannot write `custom:tenant_id` or `custom:role`: an attempt to update them through the app client fails.
- **AC-02.6** Access and ID tokens last 1 hour and the refresh token 30 days (Cognito defaults). Signing out revokes the refresh token; an access token already issued stays valid until it expires.
- **AC-02.7** A second sign-up with the email of an unconfirmed user is rejected. This is Cognito's managed behavior and is assumed, not tested (ADR-0007).

## Tests

- **Unit and integration:** the shared token check (AC-02.3, AC-02.4) against a set of token fixtures: missing, malformed, expired, wrongly signed, valid with a tenant, valid without a tenant.
- **Cross-tenant negative tests:** AC-02.4 is the case that applies here: a token without a tenant reaches nothing but `POST /tenants`.
- **Cognito checks (run against the dev user pool from the owner's machine, because CI has no AWS access, ADR-0006):** AC-02.1, AC-02.5 and the token lifetimes in AC-02.6.

## Choices to confirm

1. A token without a tenant gets `403 tenant_required` elsewhere (AC-02.4).
2. Token lifetimes are the Cognito defaults (AC-02.6).
