import { ApiError } from '@slotwise/shared';
import type { ListQuery } from '../http/list-query.js';
import { decodePageToken, encodePageToken } from '../http/page-token.js';
import type { Logger, StaffLookup } from '../services/services.js';
import type { CreateStaffRequest, UpdateStaffRequest } from './staff-schema.js';

export interface StaffRecord {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export type StaffChanges = Partial<Pick<StaffRecord, 'name' | 'active'>>;

/** Thrown by a repository when the staff member does not exist for that tenant. */
export class StaffMissingError extends Error {}

export interface StaffRepository extends StaffLookup {
  create(tenantId: string, member: StaffRecord): Promise<void>;
  get(tenantId: string, staffId: string): Promise<StaffRecord | undefined>;
  /** Staff of one tenant in id order, after `startAfterId`. `lastId` is set when more may follow. */
  list(
    tenantId: string,
    options: { limit: number; includeInactive: boolean; startAfterId?: string },
  ): Promise<{ items: StaffRecord[]; lastId?: string }>;
  /** Applies `changes` to an existing staff member, or throws `StaffMissingError`. */
  update(tenantId: string, staffId: string, changes: StaffChanges): Promise<StaffRecord>;
}

export interface StaffDeps {
  repository: StaffRepository;
  newId: () => string;
  now: () => Date;
  logger: Logger;
}

const notFound = (): ApiError => new ApiError(404, 'not_found', 'Not found.');

export async function createStaff(
  deps: StaffDeps,
  tenantId: string,
  input: CreateStaffRequest,
): Promise<StaffRecord> {
  const member: StaffRecord = {
    id: deps.newId(),
    name: input.name,
    active: true,
    createdAt: deps.now().toISOString(),
  };
  await deps.repository.create(tenantId, member);
  deps.logger.info('staff member created', { tenantId, staffId: member.id });
  return member;
}

export async function listStaff(
  deps: StaffDeps,
  tenantId: string,
  query: ListQuery,
): Promise<{ items: StaffRecord[]; nextToken?: string }> {
  const startAfterId =
    query.nextToken === undefined ? undefined : decodePageToken(query.nextToken, tenantId);
  const page = await deps.repository.list(tenantId, {
    limit: query.limit,
    includeInactive: query.includeInactive,
    ...(startAfterId === undefined ? {} : { startAfterId }),
  });
  return {
    items: page.items,
    ...(page.lastId === undefined ? {} : { nextToken: encodePageToken(tenantId, page.lastId) }),
  };
}

export async function getStaff(
  deps: StaffDeps,
  tenantId: string,
  staffId: string,
): Promise<StaffRecord> {
  // A staff member of another tenant is simply absent under this tenant's key.
  const member = await deps.repository.get(tenantId, staffId);
  if (member === undefined) throw notFound();
  return member;
}

export async function updateStaff(
  deps: StaffDeps,
  tenantId: string,
  staffId: string,
  request: UpdateStaffRequest,
): Promise<StaffRecord> {
  const changes: StaffChanges = {};
  if (request.name !== undefined) changes.name = request.name;
  if (request.active !== undefined) changes.active = request.active;
  try {
    const updated = await deps.repository.update(tenantId, staffId, changes);
    deps.logger.info('staff member updated', { tenantId, staffId });
    return updated;
  } catch (e) {
    if (e instanceof StaffMissingError) throw notFound();
    throw e;
  }
}
