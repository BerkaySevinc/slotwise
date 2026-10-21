import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ApiError } from './errors.js';

export type Role = 'owner' | 'staff';

export interface Caller {
  /** Cognito user id. */
  userId: string;
  /** Absent for a verified user who has not created a business yet (ADR-0007). */
  tenantId?: string;
  role?: Role;
}

export interface TenantCaller extends Caller {
  tenantId: string;
  role: Role;
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Reads the caller from the claims verified by the API Gateway JWT authorizer. */
export function getCaller(event: APIGatewayProxyEventV2WithJWTAuthorizer): Caller {
  const claims = event.requestContext.authorizer.jwt.claims;
  const userId = claims['sub'];
  if (typeof userId !== 'string' || userId === '') {
    throw new ApiError(401, 'unauthorized', 'Authentication is required.');
  }
  const tenantId = claims['custom:tenant_id'];
  const role = claims['custom:role'];
  const caller: Caller = { userId };
  if (typeof tenantId === 'string' && ULID_PATTERN.test(tenantId)) caller.tenantId = tenantId;
  if (role === 'owner' || role === 'staff') caller.role = role;
  return caller;
}

/** Every endpoint except POST /tenants calls this; the tenant id never comes from path or body. */
export function requireTenant(caller: Caller): TenantCaller {
  if (caller.tenantId === undefined || caller.role === undefined) {
    throw new ApiError(403, 'tenant_required', 'Create a business first.');
  }
  return { ...caller, tenantId: caller.tenantId, role: caller.role };
}
