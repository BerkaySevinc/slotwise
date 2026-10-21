import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { buildHandler } from './app.js';
import { makeDeps } from './testing.js';

// AC-01.19: logs contain ids and error codes, never the body, the email or the business name.
// This checks everything the application passes to its logger; the Powertools logger itself does
// not log the event unless configured to, which is verified after deploy.
const NAME = 'Zeynep Secret Salon';
const EMAIL = 'zeynep.owner@example.com';
const SLUG = 'zeynep-secret';

function event(rawBody: string): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    headers: { 'idempotency-key': 'logging-0001' },
    body: rawBody,
    isBase64Encoded: false,
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'user-1', email: EMAIL }, scopes: null } },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const body = JSON.stringify({ name: NAME, slug: SLUG, timeZone: 'Europe/Istanbul' });

function run(overrides: Parameters<typeof makeDeps>[0], raw: string) {
  const lines: string[] = [];
  const record = (message: string, extra?: Record<string, unknown>) =>
    lines.push(JSON.stringify({ message, ...extra }));
  const deps = makeDeps({ logger: { info: record, error: record }, ...overrides });
  const handler = buildHandler({ ...deps, makeIdempotent: (fn) => fn });
  return handler(event(raw)).then(() => lines.join('\n'));
}

describe('logging', () => {
  const leaks = (logged: string) =>
    [NAME, EMAIL, SLUG, 'Europe/Istanbul'].filter((secret) => logged.includes(secret));

  it.each([
    ['success', {}, body],
    [
      'Cognito failure',
      { directory: { setOwnerClaims: () => Promise.reject(new Error(NAME)) } },
      body,
    ],
    [
      'activation failure',
      {
        repository: {
          findOwnerTenantId: () => Promise.resolve(undefined),
          createProvisioning: () => Promise.resolve(),
          activate: () => Promise.reject(new Error(`${NAME} ${EMAIL}`)),
        } as never,
      },
      body,
    ],
    [
      'unexpected error carrying personal data in its message',
      {
        repository: {
          findOwnerTenantId: () => Promise.reject(new Error(`${NAME} ${EMAIL} ${SLUG}`)),
        } as never,
      },
      body,
    ],
    ['malformed body', {}, `{"name":"${NAME}","email":"${EMAIL}"`],
    ['invalid body', {}, JSON.stringify({ name: NAME, slug: 'admin', email: EMAIL })],
  ])('does not log personal data on: %s', async (_label, overrides, raw) => {
    const logged = await run(overrides, raw);
    expect(leaks(logged)).toEqual([]);
  });

  it('does log ids so a failure can be traced', async () => {
    const logged = await run(
      { directory: { setOwnerClaims: () => Promise.reject(new Error('x')) } },
      body,
    );
    expect(logged).toContain('provisioning incomplete');
    expect(logged).toContain('tenantId');
  });
});
