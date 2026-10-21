import { IdempotencyValidationError } from '@aws-lambda-powertools/idempotency';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { buildHandler, type AppDeps } from './app.js';
import { makeDeps } from './testing.js';

const body = { name: 'Ahmet Berber', slug: 'ahmet-berber', timeZone: 'Europe/Istanbul' };

function event(
  overrides: {
    body?: string | undefined;
    headers?: Record<string, string>;
    claims?: Record<string, string>;
    isBase64Encoded?: boolean;
  } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const hasBody = 'body' in overrides;
  return {
    headers: { 'idempotency-key': 'retry-0001-aaaa', ...overrides.headers },
    body: hasBody ? overrides.body : JSON.stringify(body),
    isBase64Encoded: overrides.isBase64Encoded ?? false,
    requestContext: {
      authorizer: { jwt: { claims: overrides.claims ?? { sub: 'user-1' }, scopes: null } },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function appWith(overrides: Partial<AppDeps> = {}) {
  const deps = makeDeps();
  const app = buildHandler({ ...deps, makeIdempotent: (fn) => fn, ...overrides });
  return { app, deps };
}

const parse = (r: { body?: string | undefined }): Record<string, unknown> =>
  JSON.parse(r.body ?? 'null') as Record<string, unknown>;

describe('POST /tenants handler', () => {
  it('returns 201 with the tenant', async () => {
    const { app } = appWith();
    const res = await app(event());
    expect(res.statusCode).toBe(201);
    expect(parse(res)).toMatchObject({
      ...body,
      status: 'active',
      createdAt: expect.any(String) as string,
    });
    expect(parse(res)['ownerId']).toBeUndefined();
  });

  it('accepts a token without a tenant (the one endpoint that does)', async () => {
    const { app } = appWith();
    expect((await app(event({ claims: { sub: 'new-user' } }))).statusCode).toBe(201);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['malformed JSON', '{"name":'],
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"x"'],
  ])('returns 400, not 500, for a %s body', async (_label, raw) => {
    const { app } = appWith();
    const res = await app(event({ body: raw }));
    expect(res.statusCode).toBe(400);
    expect(parse(res)['code']).toBe('validation_failed');
  });

  it('decodes a base64 body', async () => {
    const { app } = appWith();
    const res = await app(
      event({ body: Buffer.from(JSON.stringify(body)).toString('base64'), isBase64Encoded: true }),
    );
    expect(res.statusCode).toBe(201);
  });

  it.each(['tenantId', 'ownerId', 'role'])(
    'rejects %s in the body and never uses it',
    async (k) => {
      const { app, deps } = appWith();
      const res = await app(event({ body: JSON.stringify({ ...body, [k]: 'EVIL' }) }));
      expect(res.statusCode).toBe(400);
      expect(parse(res)['details']).toEqual([{ field: k, issue: 'unrecognized' }]);
      expect(deps.repository.tenants.size).toBe(0);
    },
  );

  it('reports the reserved slug issue', async () => {
    const { app } = appWith();
    const res = await app(event({ body: JSON.stringify({ ...body, slug: 'admin' }) }));
    expect(parse(res)['details']).toEqual([{ field: 'slug', issue: 'reserved' }]);
  });

  it.each([undefined, '', 'short', 'x'.repeat(129)])(
    'requires an Idempotency-Key of 8 to 128 characters (%s)',
    async (key) => {
      const { app } = appWith();
      const headers = key === undefined ? { 'idempotency-key': '' } : { 'idempotency-key': key };
      const res = await app(event({ headers }));
      expect(res.statusCode).toBe(400);
    },
  );

  it('returns 401 for a token without sub', async () => {
    const { app } = appWith();
    expect((await app(event({ claims: {} }))).statusCode).toBe(401);
  });

  it('returns 409 slug_taken and 409 tenant_already_exists', async () => {
    const { app } = appWith();
    await app(event());
    const taken = await app(event({ claims: { sub: 'user-2' } }));
    expect([taken.statusCode, parse(taken)['code']]).toEqual([409, 'slug_taken']);
    const again = await app(event());
    expect([again.statusCode, parse(again)['code']]).toEqual([409, 'tenant_already_exists']);
  });

  it('returns 503 provisioning_incomplete when Cognito fails', async () => {
    const { app } = appWith({
      directory: { setOwnerClaims: () => Promise.reject(new Error('x')) },
    });
    const res = await app(event());
    expect([res.statusCode, parse(res)['code']]).toEqual([503, 'provisioning_incomplete']);
  });

  it('returns 422 when idempotency reports a different payload', async () => {
    const { app } = appWith({
      makeIdempotent: () => () => Promise.reject(new IdempotencyValidationError('mismatch')),
    });
    const res = await app(event());
    expect([res.statusCode, parse(res)['code']]).toEqual([422, 'idempotency_key_mismatch']);
  });

  it('passes a user-scoped key and a canonical payload to the idempotency layer', async () => {
    const seen: { scope: string; payload: string }[] = [];
    const { app } = appWith({
      makeIdempotent: (fn) => (call) => {
        seen.push({ scope: call.scope, payload: call.payload });
        return fn(call);
      },
    });
    await app(
      event({
        body: `  {"timeZone":"Europe/Istanbul",\n "slug":"ahmet-berber","name":" Ahmet Berber "}`,
      }),
    );
    expect(seen).toEqual([{ scope: 'user-1:retry-0001-aaaa', payload: JSON.stringify(body) }]);
  });

  it('returns a generic 500 for an unexpected error without leaking details', async () => {
    const { app } = appWith({
      repository: {
        findOwnerTenantId: () => Promise.reject(new Error('secret detail')),
      } as unknown as AppDeps['repository'],
    });
    const res = await app(event());
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
  });
});
