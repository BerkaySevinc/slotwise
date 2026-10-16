# Slotwise

A multi-tenant online booking platform for small appointment-based businesses (barbers, hair salons, clinics, dietitians). Design goals: each business gets a branded public booking page and a dashboard, customers book a slot without creating an account, and a slot is never double-booked, even under concurrent requests.

> **Status:** pre-implementation. The design is done; code has not started.

## Planned stack

- **Backend:** TypeScript on AWS Lambda behind API Gateway
- **Data and identity:** DynamoDB (single table), Cognito
- **Async work:** EventBridge, EventBridge Scheduler, SQS with a DLQ, SES
- **Frontend:** React + Vite + TypeScript, hosted on S3 + CloudFront
- **Infrastructure:** Terraform
- **CI/CD:** GitHub Actions with OIDC to AWS

## Repository layout

| Path | Contents |
|---|---|
| [`api/`](api/) | OpenAPI contract shared by backend and frontend |
| [`docs/`](docs/) | Architecture decision records and design notes |
| [`backend/`](backend/) | Lambda functions and shared libraries |
| [`frontend/`](frontend/) | Single-page application |
| [`infra/`](infra/) | Terraform code |
| [`tests/`](tests/) | Contract, concurrency, cross-tenant and end-to-end tests |

## Roadmap

Foundation, core booking, notifications and branding, then hardening and a pilot with a real business.

## License

To be decided before the first release.
