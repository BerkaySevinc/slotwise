import {
  NotProvisioningError,
  OwnerExistsError,
  SlugTakenError,
  type CreateTenantDeps,
  type TenantRecord,
  type TenantRepository,
} from './create-tenant.js';

/** In-memory stand-in with the same constraints as the table. It proves the use case, not DynamoDB. */
export class InMemoryTenantRepository implements TenantRepository {
  readonly tenants = new Map<string, TenantRecord>();
  readonly slugs = new Map<string, string>();
  readonly owners = new Map<string, string>();

  findOwnerTenantId(userId: string): Promise<string | undefined> {
    return Promise.resolve(this.owners.get(userId));
  }

  getTenant(tenantId: string): Promise<TenantRecord | undefined> {
    const t = this.tenants.get(tenantId);
    return Promise.resolve(t && { ...t });
  }

  createProvisioning(tenant: TenantRecord): Promise<void> {
    if (this.owners.has(tenant.ownerId)) return Promise.reject(new OwnerExistsError());
    if (this.slugs.has(tenant.slug)) return Promise.reject(new SlugTakenError());
    this.tenants.set(tenant.id, { ...tenant });
    this.slugs.set(tenant.slug, tenant.id);
    this.owners.set(tenant.ownerId, tenant.id);
    return Promise.resolve();
  }

  updateProvisioning(
    tenant: TenantRecord,
    changes: { name: string; slug: string; timeZone: string },
  ): Promise<void> {
    const current = this.tenants.get(tenant.id);
    if (current?.status !== 'provisioning') return Promise.reject(new NotProvisioningError());
    if (changes.slug !== current.slug) {
      if (this.slugs.has(changes.slug)) return Promise.reject(new SlugTakenError());
      this.slugs.delete(current.slug);
      this.slugs.set(changes.slug, current.id);
    }
    Object.assign(current, changes);
    return Promise.resolve();
  }

  activate(tenantId: string): Promise<void> {
    const t = this.tenants.get(tenantId);
    if (t) t.status = 'active';
    return Promise.resolve();
  }
}

export function makeDeps(
  overrides: Partial<CreateTenantDeps> = {},
): CreateTenantDeps & { repository: InMemoryTenantRepository; incomplete: { count: number } } {
  const incomplete = { count: 0 };
  let n = 0;
  return {
    repository: new InMemoryTenantRepository(),
    directory: { setOwnerClaims: () => Promise.resolve() },
    newId: () => `TENANT${String(++n).padStart(20, '0')}`,
    now: () => new Date('2026-10-21T10:00:00.000Z'),
    logger: { info: () => undefined, error: () => undefined },
    onProvisioningIncomplete: () => {
      incomplete.count++;
    },
    incomplete,
    ...overrides,
  } as CreateTenantDeps & { repository: InMemoryTenantRepository; incomplete: { count: number } };
}
