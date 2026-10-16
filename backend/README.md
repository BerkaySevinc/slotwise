# Backend

TypeScript on Node.js, deployed as AWS Lambda functions. **Status: not started.**

## Planned functions

| Function | Responsibility |
|---|---|
| `tenant-api` | Onboarding, branding, users and invitations |
| `catalog-api` | Services, staff, working hours, time off |
| `availability-api` | Read-only slot computation |
| `booking-api` | Create, cancel and update appointments; owns locking and idempotency |
| `notification-worker` | Consumes the SQS queue and sends email through SES |
| `report-worker` | Weekly summary email per tenant |

## Layout

```
backend/
├── functions/<name>/     one folder per Lambda function
└── packages/shared/      tenant-aware authorization, validation, logging, DynamoDB key helpers
```

## Conventions

- The tenant id always comes from the verified JWT, never from the request path or body.
- Handlers validate input at the boundary and return `400` for malformed or null bodies.
- Every authenticated endpoint has a cross-tenant negative test.