import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ApiError, getCaller, requireTenant } from '@slotwise/shared';
import { errorResponse, readJson, type RouteRequest } from './http/response.js';
import { handleServiceRoute } from './services/routes.js';
import type { Logger, ServiceDeps } from './services/services.js';
import { handleStaffRoute } from './staff/routes.js';
import type { StaffDeps } from './staff/staff.js';

export interface AppDeps {
  services: ServiceDeps;
  staff: StaffDeps;
  logger: Logger;
}

export function buildHandler(deps: AppDeps) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      // The same check for every route: a token without a tenant reaches none of them (AC-02.4).
      const caller = requireTenant(getCaller(event));
      const request: RouteRequest = {
        body: () => readJson(event),
        query: event.queryStringParameters,
        id: event.pathParameters?.['serviceId'] ?? event.pathParameters?.['staffId'] ?? '',
      };
      const response =
        (await handleServiceRoute(deps.services, event.routeKey, caller, request)) ??
        (await handleStaffRoute(deps.staff, event.routeKey, caller, request));
      if (response === undefined) throw new ApiError(404, 'not_found', 'Not found.');
      return response;
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e);
      deps.logger.error('unhandled error', {
        errorName: e instanceof Error ? e.name : 'unknown',
      });
      return errorResponse(new ApiError(500, 'internal_error', 'Something went wrong.'));
    }
  };
}
