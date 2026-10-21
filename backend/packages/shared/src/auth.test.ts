import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { getCaller, requireTenant } from './auth.js';
import { ApiError } from './errors.js';

const TENANT = '01JABCDEFGHJKMNPQRSTVWXYZ0';

function eventWith(claims: Record<string, string>): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    requestContext: { authorizer: { jwt: { claims, scopes: null } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('getCaller', () => {
  it('reads sub, tenant and role from the claims', () => {
    const caller = getCaller(
      eventWith({ sub: 'u1', 'custom:tenant_id': TENANT, 'custom:role': 'owner' }),
    );
    expect(caller).toEqual({ userId: 'u1', tenantId: TENANT, role: 'owner' });
  });
  it('returns a caller without tenant for a new user', () => {
    expect(getCaller(eventWith({ sub: 'u1' }))).toEqual({ userId: 'u1' });
  });
  it('ignores a malformed tenant id and an unknown role', () => {
    const caller = getCaller(
      eventWith({ sub: 'u1', 'custom:tenant_id': 'not-a-ulid', 'custom:role': 'root' }),
    );
    expect(caller).toEqual({ userId: 'u1' });
  });
  it('rejects a token without sub with 401', () => {
    expect(() => getCaller(eventWith({}))).toThrow(ApiError);
  });
});

describe('requireTenant', () => {
  it('returns the tenant caller', () => {
    expect(requireTenant({ userId: 'u1', tenantId: TENANT, role: 'staff' }).tenantId).toBe(TENANT);
  });
  it.each([{ userId: 'u1' }, { userId: 'u1', tenantId: TENANT }])(
    'throws 403 tenant_required for %j',
    (caller) => {
      try {
        requireTenant(caller);
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ statusCode: 403, code: 'tenant_required' });
      }
    },
  );
});
