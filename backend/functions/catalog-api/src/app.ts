import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  ApiError,
  getCaller,
  requireRole,
  requireTenant,
  type ParseResult,
} from '@slotwise/shared';
import {
  parseCreateServiceRequest,
  parseListServicesQuery,
  parseUpdateServiceRequest,
} from './service-schema.js';
import {
  createService,
  getService,
  listServices,
  updateService,
  type ServiceDeps,
  type ServiceRecord,
} from './services.js';

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const errorResponse = (e: ApiError): APIGatewayProxyStructuredResultV2 =>
  json(e.statusCode, {
    code: e.code,
    message: e.message,
    ...(e.details === undefined ? {} : { details: e.details }),
  });

const invalid = (field: string, issue: string): ApiError =>
  new ApiError(400, 'validation_failed', 'The request is not valid.', [{ field, issue }]);

const valid = <T>(result: ParseResult<T>): T => {
  if (!result.ok) {
    throw new ApiError(400, 'validation_failed', 'The request is not valid.', result.details);
  }
  return result.value;
};

function readJson(event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown {
  if (event.body === undefined || event.body === '') throw invalid('body', 'required');
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw invalid('body', 'malformed');
  }
}

// The response shape of the OpenAPI `Service` schema; the tenant id is never part of it.
const present = (s: ServiceRecord) => ({
  id: s.id,
  name: s.name,
  durationMinutes: s.durationMinutes,
  bufferMinutes: s.bufferMinutes,
  priceMinor: s.priceMinor,
  active: s.active,
  createdAt: s.createdAt,
});

export function buildHandler(deps: ServiceDeps) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      // The same check for every route: a token without a tenant reaches none of them (AC-02.4).
      const caller = requireTenant(getCaller(event));
      const { tenantId } = caller;
      const serviceId = event.pathParameters?.['serviceId'] ?? '';

      switch (event.routeKey) {
        case 'POST /services': {
          requireRole(caller, 'owner');
          const input = valid(parseCreateServiceRequest(readJson(event)));
          return json(201, present(await createService(deps, tenantId, input)));
        }
        case 'GET /services': {
          requireRole(caller, 'owner', 'staff');
          const query = valid(parseListServicesQuery(event.queryStringParameters));
          const page = await listServices(deps, tenantId, query);
          return json(200, {
            items: page.items.map(present),
            ...(page.nextToken === undefined ? {} : { nextToken: page.nextToken }),
          });
        }
        case 'GET /services/{serviceId}':
          requireRole(caller, 'owner', 'staff');
          return json(200, present(await getService(deps, tenantId, serviceId)));
        case 'PATCH /services/{serviceId}': {
          requireRole(caller, 'owner');
          const changes = valid(parseUpdateServiceRequest(readJson(event)));
          return json(200, present(await updateService(deps, tenantId, serviceId, changes)));
        }
        default:
          throw new ApiError(404, 'not_found', 'Not found.');
      }
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e);
      deps.logger.error('unhandled error', {
        errorName: e instanceof Error ? e.name : 'unknown',
      });
      return errorResponse(new ApiError(500, 'internal_error', 'Something went wrong.'));
    }
  };
}
