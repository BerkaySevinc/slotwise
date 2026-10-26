import {
  ServiceMissingError,
  StaleServiceError,
  type ServiceChanges,
  type ServiceDeps,
  type ServiceRecord,
  type ServiceRepository,
} from './services.js';

/** In-memory stand-in with the same rules as the table. It proves the use case, not DynamoDB. */
export class InMemoryServiceRepository implements ServiceRepository {
  readonly services = new Map<string, Map<string, ServiceRecord>>();
  /** Test hook: runs once inside the next `update`, to simulate a concurrent writer. */
  beforeUpdate: (() => void) | undefined;

  private of(tenantId: string): Map<string, ServiceRecord> {
    let tenant = this.services.get(tenantId);
    if (tenant === undefined) {
      tenant = new Map();
      this.services.set(tenantId, tenant);
    }
    return tenant;
  }

  create(tenantId: string, service: ServiceRecord): Promise<void> {
    this.of(tenantId).set(service.id, { ...service });
    return Promise.resolve();
  }

  get(tenantId: string, serviceId: string): Promise<ServiceRecord | undefined> {
    const found = this.of(tenantId).get(serviceId);
    return Promise.resolve(found && { ...found });
  }

  list(
    tenantId: string,
    options: { limit: number; includeInactive: boolean; startAfterId?: string },
  ): Promise<{ items: ServiceRecord[]; lastId?: string }> {
    const all = [...this.of(tenantId).values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((s) => options.startAfterId === undefined || s.id > options.startAfterId)
      .filter((s) => options.includeInactive || s.active);
    const items = all.slice(0, options.limit).map((s) => ({ ...s }));
    const last = items.at(-1);
    return Promise.resolve(
      all.length > options.limit && last !== undefined ? { items, lastId: last.id } : { items },
    );
  }

  update(
    tenantId: string,
    serviceId: string,
    changes: ServiceChanges,
    guard?: { durationMinutes: number; bufferMinutes: number },
  ): Promise<ServiceRecord> {
    const hook = this.beforeUpdate;
    this.beforeUpdate = undefined;
    hook?.();
    const current = this.of(tenantId).get(serviceId);
    if (current === undefined) return Promise.reject(new ServiceMissingError());
    if (
      guard !== undefined &&
      (current.durationMinutes !== guard.durationMinutes ||
        current.bufferMinutes !== guard.bufferMinutes)
    ) {
      return Promise.reject(new StaleServiceError());
    }
    Object.assign(current, changes);
    return Promise.resolve({ ...current });
  }
}

export function makeDeps(
  overrides: Partial<ServiceDeps> = {},
): ServiceDeps & { repository: InMemoryServiceRepository } {
  let n = 0;
  return {
    repository: new InMemoryServiceRepository(),
    // Sortable like ULIDs: 26 characters of the allowed alphabet.
    newId: () => `0000000000000000000000${String(++n).padStart(4, '0')}`,
    now: () => new Date('2026-10-23T10:00:00.000Z'),
    logger: { info: () => undefined, error: () => undefined },
    ...overrides,
  } as ServiceDeps & { repository: InMemoryServiceRepository };
}
