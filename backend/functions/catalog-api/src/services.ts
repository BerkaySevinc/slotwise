import { ApiError } from '@slotwise/shared';
import { decodePageToken, encodePageToken } from './page-token.js';
import {
  DURATION_PLUS_BUFFER_ISSUE,
  MAX_DURATION_PLUS_BUFFER_MINUTES,
  type CreateServiceRequest,
  type ListServicesQuery,
  type UpdateServiceRequest,
} from './service-schema.js';

export interface ServiceRecord {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  priceMinor: number;
  active: boolean;
  createdAt: string;
}

export type ServiceChanges = Partial<Omit<ServiceRecord, 'id' | 'createdAt'>>;

/** Thrown by a repository when the service does not exist for that tenant. */
export class ServiceMissingError extends Error {}
/** Thrown when the duration or buffer changed since they were read (a concurrent update). */
export class StaleServiceError extends Error {}

export interface ServiceRepository {
  create(tenantId: string, service: ServiceRecord): Promise<void>;
  get(tenantId: string, serviceId: string): Promise<ServiceRecord | undefined>;
  /** Services of one tenant in id order, after `startAfterId`. `lastId` is set when more may follow. */
  list(
    tenantId: string,
    options: { limit: number; includeInactive: boolean; startAfterId?: string },
  ): Promise<{ items: ServiceRecord[]; lastId?: string }>;
  /**
   * Applies `changes` to an existing service. With `guard`, it only applies while the stored
   * duration and buffer still equal the guard, so two updates cannot together break the sum rule.
   */
  update(
    tenantId: string,
    serviceId: string,
    changes: ServiceChanges,
    guard?: { durationMinutes: number; bufferMinutes: number },
  ): Promise<ServiceRecord>;
}

export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

export interface ServiceDeps {
  repository: ServiceRepository;
  newId: () => string;
  now: () => Date;
  logger: Logger;
}

const MAX_UPDATE_ATTEMPTS = 3;

const notFound = (): ApiError => new ApiError(404, 'not_found', 'Not found.');

export async function createService(
  deps: ServiceDeps,
  tenantId: string,
  input: CreateServiceRequest,
): Promise<ServiceRecord> {
  const service: ServiceRecord = {
    id: deps.newId(),
    ...input,
    active: true,
    createdAt: deps.now().toISOString(),
  };
  await deps.repository.create(tenantId, service);
  deps.logger.info('service created', { tenantId, serviceId: service.id });
  return service;
}

export async function listServices(
  deps: ServiceDeps,
  tenantId: string,
  query: ListServicesQuery,
): Promise<{ items: ServiceRecord[]; nextToken?: string }> {
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

export async function getService(
  deps: ServiceDeps,
  tenantId: string,
  serviceId: string,
): Promise<ServiceRecord> {
  // A service of another tenant is simply absent under this tenant's key.
  const service = await deps.repository.get(tenantId, serviceId);
  if (service === undefined) throw notFound();
  return service;
}

export async function updateService(
  deps: ServiceDeps,
  tenantId: string,
  serviceId: string,
  request: UpdateServiceRequest,
): Promise<ServiceRecord> {
  const changes: ServiceChanges = {};
  if (request.name !== undefined) changes.name = request.name;
  if (request.durationMinutes !== undefined) changes.durationMinutes = request.durationMinutes;
  if (request.bufferMinutes !== undefined) changes.bufferMinutes = request.bufferMinutes;
  if (request.priceMinor !== undefined) changes.priceMinor = request.priceMinor;
  if (request.active !== undefined) changes.active = request.active;

  const touchesSum = changes.durationMinutes !== undefined || changes.bufferMinutes !== undefined;

  for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
    const current = await deps.repository.get(tenantId, serviceId);
    if (current === undefined) throw notFound();

    const merged = { ...current, ...changes };
    if (merged.durationMinutes + merged.bufferMinutes > MAX_DURATION_PLUS_BUFFER_MINUTES) {
      const field = changes.durationMinutes !== undefined ? 'durationMinutes' : 'bufferMinutes';
      throw new ApiError(400, 'validation_failed', 'The request is not valid.', [
        { field, issue: DURATION_PLUS_BUFFER_ISSUE },
      ]);
    }

    try {
      const updated = await deps.repository.update(
        tenantId,
        serviceId,
        changes,
        touchesSum
          ? { durationMinutes: current.durationMinutes, bufferMinutes: current.bufferMinutes }
          : undefined,
      );
      deps.logger.info('service updated', { tenantId, serviceId });
      return updated;
    } catch (e) {
      if (e instanceof ServiceMissingError) throw notFound();
      if (!(e instanceof StaleServiceError)) throw e;
    }
  }
  throw new ApiError(503, 'try_again', 'The service is busy. Try again.');
}
