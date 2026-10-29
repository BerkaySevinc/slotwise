import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { requireRole, type TenantCaller } from '@slotwise/shared';
import { parseListQuery } from '../http/list-query.js';
import { json, valid, type RouteRequest } from '../http/response.js';
import { parseCreateServiceRequest, parseUpdateServiceRequest } from './service-schema.js';
import {
  createService,
  getService,
  listServices,
  updateService,
  type ServiceDeps,
  type ServiceRecord,
} from './services.js';

// The response shape of the OpenAPI `Service` schema; the tenant id is never part of it.
const present = (s: ServiceRecord) => ({
  id: s.id,
  name: s.name,
  durationMinutes: s.durationMinutes,
  bufferMinutes: s.bufferMinutes,
  priceMinor: s.priceMinor,
  active: s.active,
  staffIds: s.staffIds,
  createdAt: s.createdAt,
});

/** Returns undefined when the route is not a service route. */
export async function handleServiceRoute(
  deps: ServiceDeps,
  routeKey: string,
  caller: TenantCaller,
  request: RouteRequest,
): Promise<APIGatewayProxyStructuredResultV2 | undefined> {
  const { tenantId } = caller;
  switch (routeKey) {
    case 'POST /services': {
      requireRole(caller, 'owner');
      const input = valid(parseCreateServiceRequest(request.body()));
      return json(201, present(await createService(deps, tenantId, input)));
    }
    case 'GET /services': {
      requireRole(caller, 'owner', 'staff');
      const query = valid(parseListQuery(request.query));
      const page = await listServices(deps, tenantId, query);
      return json(200, {
        items: page.items.map(present),
        ...(page.nextToken === undefined ? {} : { nextToken: page.nextToken }),
      });
    }
    case 'GET /services/{serviceId}':
      requireRole(caller, 'owner', 'staff');
      return json(200, present(await getService(deps, tenantId, request.id)));
    case 'PATCH /services/{serviceId}': {
      requireRole(caller, 'owner');
      const changes = valid(parseUpdateServiceRequest(request.body()));
      return json(200, present(await updateService(deps, tenantId, request.id, changes)));
    }
    default:
      return undefined;
  }
}
