# ADR-0007: Owner registration and sign-in

## Status

Accepted

## Context

ADR-0001 keeps the tenant id and role in Cognito custom attributes that the app client cannot write, and says owner registration runs through a backend function with Cognito self sign-up disabled. It does not describe the flow end to end. Registration touches two systems (DynamoDB for the tenant, Cognito for the user attributes) that cannot share a transaction, and the slug is a scarce public name that must not be held by someone who has not proven control of an email address.

## Decision

- **Identity first, tenant second.** An owner signs up with Cognito's standard flow: email and password, then a verification code. The email must be verified before the first sign-in. Sign-in goes straight to Cognito; our API has no registration or `/login` endpoint. Self sign-up is safe because the app client has no write access to `custom:tenant_id` and `custom:role` (ADR-0001); this replaces ADR-0001's "self sign-up is disabled".
- **A new user has no tenant.** Their token has no `custom:tenant_id`. Every endpoint except `POST /tenants` rejects such a token. These users are a normal intermediate state, not an error. Staff added later (US-07) are created with the admin API with their tenant and role already set, so they are never without a tenant.
- **`POST /tenants`** (authenticated, with an `Idempotency-Key`) takes the business name, slug and time zone:
  1. Validate the input; invalid input returns `400`.
  2. In one DynamoDB transaction write the tenant (status `provisioning`, with the owner's user id), its default settings, the slug item (it must not exist, otherwise `409` at once) and an owner lookup item keyed by user id (it must not exist). The lookup item enforces one tenant per user and finds the tenant on a retry.
  3. Set `custom:tenant_id` and `custom:role = owner` on the user with the Cognito admin API.
  4. Set the tenant to `active`.
  5. The client refreshes its session to get a token with the new attributes.
- **Retries are safe.** If the caller already has a tenant, the same call skips the steps already done and repeats the missing ones. While the tenant is still `provisioning` the retry may carry a different slug (the old slug item is replaced in one transaction). After `active` the slug does not change in the MVP.
- **A `provisioning` tenant holds its slug and is not public.** The public booking page works only for `active` tenants. An abandoned `provisioning` tenant keeps its slug in the MVP; cleaning those up (through a sparse index on the status) is deferred.
- **A failure of the Cognito step raises a metric and an alarm,** so a permanent fault (for example a missing permission) is not silent.
- **Slug rules:** lowercase letters, digits and hyphens, 3 to 30 characters, no leading, trailing or double hyphen, reserved words rejected. The slug is a public address only; the tenant is identified by its id.
- **One user belongs to one tenant, and a tenant has one owner, in the MVP.** One account per email address (Cognito rejects a second sign-up). Several tenants per user is out of scope. Later it needs membership items (backfilled from the owner user id stored on each tenant), an active-tenant choice in the API and the frontend, and a token mechanism (a Pre Token Generation trigger or a per-request lookup). That is a new ADR that supersedes this one and the attribute part of ADR-0001. Every handler reads the tenant only from the shared authorization layer, so the source can change in one place.
- **Accepted risk: account pre-hijacking.** Someone can sign up with another person's email and their own password; if the owner of that email later confirms the account, the attacker knows its password. The account holds no tenant data until a tenant exists, the owner can recover it with a password reset, and this is the sign-up form small business owners know. Accepted for the MVP and revisited if abuse appears; switching to "email first, then code and password chosen together" changes the user pool configuration and the frontend only.

## Consequences

- Tenant creation is one DynamoDB transaction plus one Cognito write; a failure between them leaves a `provisioning` tenant that the same call completes. No data is lost and nothing is reachable by the user until the attributes are set.
- Tenant-less users accumulate in the user pool if people verify and never create a business. They hold no data; a cleanup job is optional and not in the MVP.
- A role change takes effect when the token is refreshed; keep token lifetimes short and revoke sessions with the admin API when a role is removed.
- Registering an existing email reveals that it has an account, and public sign-up is rate limited by Cognito only; AWS WAF rules in front of the user pool are the next step if abuse appears.
- Cognito's default email setting is limited to 50 emails per day per AWS account (checked 2026-10-21, not adjustable). Enough for development; before real owners sign up, the user pool must send through SES (verified sender in the same Region, account out of the SES sandbox).
- Assumption, not tested: a second sign-up for an email that is still unconfirmed is rejected and changes neither the pending password nor the pending code. The Cognito documentation lists `UsernameExistsException` for taken names but does not describe the unconfirmed case; we rely on Cognito's managed behavior. If it turns out that a later sign-up can overwrite a pending one, someone could replace the owner's password between their sign-up and their code entry, and the flow would need to change; switching to "email first, then code and password chosen together" is one option, to be decided then.
- To confirm when building the user pool: which token (ID or access token) carries the custom attributes for the API Gateway JWT authorizer, and which Cognito feature plan the account has (customizing the access token needs a trigger and a paid-tier plan).
- Users who run several businesses need one email address per business until several tenants per user are supported.

## Alternatives considered

- **Tenant and role as membership items in DynamoDB, read on every request:** one write system and an easy path to several tenants per user, but one extra read on every request, a different shape from the usual AWS pattern, and a rewrite of the tenancy rules. Rejected for now; it is the likely route if several tenants per user are needed.
- **Pre Token Generation trigger:** copies tenant and role from DynamoDB into the token at sign-in; puts a Lambda in the sign-in path. Possible later without a data change.
- **Email first, then verification code and password chosen together:** removes the pre-hijacking exposure with no extra state, but is a less familiar form and depends on Cognito behavior that needs a test first.
- **Sign-up bound to the browser that started it (registration record and secret):** also removes the exposure, but needs our own pending state, expiry and cleanup.
- **Pending tenant created at registration:** lets someone hold a slug before proving who they are and mixes unverified data into the owner's account.
- **Cognito email one-time-code sign-in (passwordless):** needs the SES email setting and a paid feature plan; considered after the pilot.
