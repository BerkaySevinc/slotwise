import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export interface TestCaller {
  sub: string;
  tenantId?: string;
  role?: 'owner' | 'staff';
}

export interface EventOptions {
  routeKey: string;
  caller?: TestCaller | undefined;
  /** Sent as is; pass a string to send malformed JSON. */
  body?: unknown;
  pathParameters?: Record<string, string>;
  query?: Record<string, string>;
}

/** An API Gateway HTTP API event as the Lambda sees it after the JWT authorizer accepted the token. */
export function apiEvent(options: EventOptions): APIGatewayProxyEventV2WithJWTAuthorizer {
  const caller = options.caller ?? { sub: 'user-1' };
  const claims: Record<string, string> = { sub: caller.sub };
  if (caller.tenantId !== undefined) claims['custom:tenant_id'] = caller.tenantId;
  if (caller.role !== undefined) claims['custom:role'] = caller.role;
  const hasBody = 'body' in options;
  return {
    routeKey: options.routeKey,
    headers: {},
    pathParameters: options.pathParameters,
    queryStringParameters: options.query,
    body: !hasBody
      ? undefined
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body),
    isBase64Encoded: false,
    requestContext: { authorizer: { jwt: { claims, scopes: null } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

export const TENANT_A = '01JAAAAAAAAAAAAAAAAAAAAAAA';
export const TENANT_B = '01JBBBBBBBBBBBBBBBBBBBBBBB';
export const ownerOf = (tenantId: string): TestCaller => ({
  sub: `owner-${tenantId}`,
  tenantId,
  role: 'owner',
});
export const staffOf = (tenantId: string): TestCaller => ({
  sub: `staff-${tenantId}`,
  tenantId,
  role: 'staff',
});

/** Every route the catalog API serves, with the path parameters it needs. */
export const CATALOG_ROUTES: {
  routeKey: string;
  pathParameters?: Record<string, string>;
  body?: unknown;
}[] = [
  { routeKey: 'POST /services', body: { name: 'x', durationMinutes: 30, priceMinor: 1 } },
  { routeKey: 'GET /services' },
  {
    routeKey: 'GET /services/{serviceId}',
    pathParameters: { serviceId: '01JSVCSVCSVCSVCSVCSVCSVCSV' },
  },
  {
    routeKey: 'PATCH /services/{serviceId}',
    pathParameters: { serviceId: '01JSVCSVCSVCSVCSVCSVCSVCSV' },
    body: { active: false },
  },
];
