# Frontend

React + Vite + TypeScript single-page application, hosted on S3 behind CloudFront. **Status: not started.**

## Planned areas

| Route | Audience | Purpose |
|---|---|---|
| `/t/:slug` | Guests | Public booking page of one business: services, staff, available slots, booking, cancellation |
| `/app` | Owners and staff | Dashboard: calendar, services, staff, working hours, branding |

## Conventions

- The API client is generated from the OpenAPI specification.
- Branding (logo, primary color, name, welcome text) is loaded per tenant at runtime and applied through CSS variables, so one build serves every tenant.
- No mocked or hard-coded data in application code.
