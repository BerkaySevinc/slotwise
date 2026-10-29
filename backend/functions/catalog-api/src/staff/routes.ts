import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { requireRole, type TenantCaller } from '@slotwise/shared';
import { parseListQuery } from '../http/list-query.js';
import { json, valid, type RouteRequest } from '../http/response.js';
import { parseCreateStaffRequest, parseUpdateStaffRequest } from './staff-schema.js';
import {
  createStaff,
  getStaff,
  listStaff,
  updateStaff,
  type StaffDeps,
  type StaffRecord,
} from './staff.js';

// The response shape of the OpenAPI `Staff` schema; the tenant id is never part of it.
const present = (m: StaffRecord) => ({
  id: m.id,
  name: m.name,
  active: m.active,
  createdAt: m.createdAt,
});

/** Returns undefined when the route is not a staff route. */
export async function handleStaffRoute(
  deps: StaffDeps,
  routeKey: string,
  caller: TenantCaller,
  request: RouteRequest,
): Promise<APIGatewayProxyStructuredResultV2 | undefined> {
  const { tenantId } = caller;
  switch (routeKey) {
    case 'POST /staff': {
      requireRole(caller, 'owner');
      const input = valid(parseCreateStaffRequest(request.body()));
      return json(201, present(await createStaff(deps, tenantId, input)));
    }
    case 'GET /staff': {
      requireRole(caller, 'owner', 'staff');
      const query = valid(parseListQuery(request.query));
      const page = await listStaff(deps, tenantId, query);
      return json(200, {
        items: page.items.map(present),
        ...(page.nextToken === undefined ? {} : { nextToken: page.nextToken }),
      });
    }
    case 'GET /staff/{staffId}':
      requireRole(caller, 'owner', 'staff');
      return json(200, present(await getStaff(deps, tenantId, request.id)));
    case 'PATCH /staff/{staffId}': {
      requireRole(caller, 'owner');
      const changes = valid(parseUpdateStaffRequest(request.body()));
      return json(200, present(await updateStaff(deps, tenantId, request.id, changes)));
    }
    default:
      return undefined;
  }
}
