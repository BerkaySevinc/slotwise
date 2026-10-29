import type { AppDeps } from './app.js';
import {
  ServiceMissingError,
  StaleServiceError,
  type ServiceChanges,
  type ServiceDeps,
  type ServiceRecord,
  type ServiceRepository,
} from './services/services.js';
import {
  StaffMissingError,
  type StaffChanges,
  type StaffDeps,
  type StaffRecord,
  type StaffRepository,
} from './staff/staff.js';

interface ListOptions {
  limit: number;
  includeInactive: boolean;
  startAfterId?: string;
}

/** One page in id order, like the table: after `startAfterId`, retired items skipped unless asked. */
function page<T extends { id: string; active: boolean }>(
  all: T[],
  options: ListOptions,
): { items: T[]; lastId?: string } {
  const matching = [...all]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((s) => options.startAfterId === undefined || s.id > options.startAfterId)
    .filter((s) => options.includeInactive || s.active);
  const items = matching.slice(0, options.limit).map((s) => ({ ...s }));
  const last = items.at(-1);
  return matching.length > options.limit && last !== undefined
    ? { items, lastId: last.id }
    : { items };
}

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
    options: ListOptions,
  ): Promise<{ items: ServiceRecord[]; lastId?: string }> {
    return Promise.resolve(page([...this.of(tenantId).values()], options));
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

export class InMemoryStaffRepository implements StaffRepository {
  readonly staff = new Map<string, Map<string, StaffRecord>>();

  private of(tenantId: string): Map<string, StaffRecord> {
    let tenant = this.staff.get(tenantId);
    if (tenant === undefined) {
      tenant = new Map();
      this.staff.set(tenantId, tenant);
    }
    return tenant;
  }

  create(tenantId: string, member: StaffRecord): Promise<void> {
    this.of(tenantId).set(member.id, { ...member });
    return Promise.resolve();
  }

  get(tenantId: string, staffId: string): Promise<StaffRecord | undefined> {
    const found = this.of(tenantId).get(staffId);
    return Promise.resolve(found && { ...found });
  }

  list(tenantId: string, options: ListOptions): Promise<{ items: StaffRecord[]; lastId?: string }> {
    return Promise.resolve(page([...this.of(tenantId).values()], options));
  }

  update(tenantId: string, staffId: string, changes: StaffChanges): Promise<StaffRecord> {
    const current = this.of(tenantId).get(staffId);
    if (current === undefined) return Promise.reject(new StaffMissingError());
    Object.assign(current, changes);
    return Promise.resolve({ ...current });
  }

  existingIds(tenantId: string, staffIds: string[]): Promise<Set<string>> {
    const tenant = this.of(tenantId);
    return Promise.resolve(new Set(staffIds.filter((id) => tenant.has(id))));
  }
}

/** Both features over in-memory repositories; the services see the same staff as the staff API. */
export function makeCatalog(overrides: Partial<Pick<AppDeps, 'logger'>> = {}) {
  let n = 0;
  const logger = overrides.logger ?? { info: () => undefined, error: () => undefined };
  const common = {
    // Sortable like ULIDs: 26 characters of the allowed alphabet.
    newId: () => `0000000000000000000000${String(++n).padStart(4, '0')}`,
    now: () => new Date('2026-10-23T10:00:00.000Z'),
    logger,
  };
  const serviceRepository = new InMemoryServiceRepository();
  const staffRepository = new InMemoryStaffRepository();
  const services: ServiceDeps = {
    ...common,
    repository: serviceRepository,
    staff: staffRepository,
  };
  const staff: StaffDeps = { ...common, repository: staffRepository };
  const app: AppDeps = { services, staff, logger };
  return { app, services, staff, serviceRepository, staffRepository };
}

/** The service side only, with the repository at hand. */
export function makeDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps & {
  repository: InMemoryServiceRepository;
  staffRepository: InMemoryStaffRepository;
} {
  const catalog = makeCatalog();
  return {
    ...catalog.services,
    ...overrides,
    repository: catalog.serviceRepository,
    staffRepository: catalog.staffRepository,
  };
}
