# ADR-0001: Tenancy model

## Status

Accepted

## Context

Slotwise serves many small businesses (tenants) from one deployment. A tenant must never read or change another tenant's data, and the platform must stay cheap to run and fast to onboard (a business should be live in minutes). Identity must also work for guests who book without an account.

## Decision

- **Shared pool with logical isolation.** All tenants share one Cognito user pool, one DynamoDB table and one set of Lambda functions. Isolation is enforced by tenant-prefixed keys, not by separate infrastructure.
- **The tenant id comes only from the verified JWT.** Each user carries `custom:tenant_id` and `custom:role`. The API Gateway JWT authorizer validates the token, and handlers read the tenant id from the verified claims, never from the path, query or body.
- **Locked attributes.** The Cognito app client has no write access to `custom:tenant_id` and `custom:role`. Owner registration therefore runs through a backend function that uses the Cognito admin APIs; Cognito self sign-up is disabled.
- **Tenant-prefixed keys through one code path.** The shared package exposes the only key builders; they require a tenant id taken from the authorization context. Handlers do not assemble keys by hand.
- **Cross-tenant access returns `404`**, not `403`, so the existence of another tenant's resource is not revealed. Every authenticated endpoint has a cross-tenant negative test that runs in CI.
- **Public routes resolve the tenant server-side.** Public booking pages use the path `/t/{slug}`. The slug is public and is looked up in the database to obtain the tenant id; no client-supplied tenant id is trusted. Guest cancellation resolves the tenant from the stored cancellation-token hash, so the token acts as the credential.
- **Roles:** guest (no account), staff, owner, platform admin. Role checks live in a shared declarative authorization layer.

## Consequences

- Cheap and simple to operate; onboarding a tenant is a few item writes.
- One bug in key construction or authorization can leak across tenants, so the key builders, the authorization layer and the negative tests carry the isolation guarantee and need the most review.
- A noisy tenant shares capacity with others; throttling on public routes limits this. DynamoDB on-demand capacity absorbs normal variation.
- No per-tenant encryption keys or per-tenant data export by account boundary; export and deletion (BR-9) are implemented by querying the tenant's items.
- Subdomains and custom tenant domains are out of scope for the MVP.

## Alternatives considered

- **User pool per tenant:** strong separation, but pool limits, per-tenant provisioning time and operational cost do not fit small businesses.
- **Table per tenant:** easier to reason about, but needs infrastructure changes on every sign-up and makes cross-tenant operations (platform admin, reports) awkward.
- **Account per tenant:** the strongest isolation and far too expensive and slow for this market.
