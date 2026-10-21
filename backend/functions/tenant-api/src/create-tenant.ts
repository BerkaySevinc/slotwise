import { ApiError, type CreateTenantRequest } from '@slotwise/shared';

export type TenantStatus = 'provisioning' | 'active';

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  status: TenantStatus;
  ownerId: string;
  createdAt: string;
}

export class SlugTakenError extends Error {}
/** The owner lookup item already exists: this user already has a tenant. */
export class OwnerExistsError extends Error {}
/** The tenant is no longer `provisioning`, so its slug can no longer change. */
export class NotProvisioningError extends Error {}
/** DynamoDB kept rejecting the transaction because of concurrent writes. */
export class TransactionConflictError extends Error {}

export interface TenantRepository {
  findOwnerTenantId(userId: string): Promise<string | undefined>;
  getTenant(tenantId: string): Promise<TenantRecord | undefined>;
  /** Writes profile, default settings, slug item and owner item in one transaction. */
  createProvisioning(tenant: TenantRecord): Promise<void>;
  /** Replaces name, slug and time zone of a `provisioning` tenant; the slug swap is one transaction. */
  updateProvisioning(
    tenant: TenantRecord,
    changes: Pick<CreateTenantRequest, 'name' | 'slug' | 'timeZone'>,
  ): Promise<void>;
  activate(tenantId: string): Promise<void>;
}

export interface OwnerDirectory {
  /** Sets `custom:tenant_id` and `custom:role = owner` on the user. */
  setOwnerClaims(userId: string, tenantId: string): Promise<void>;
}

export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

export interface CreateTenantDeps {
  repository: TenantRepository;
  directory: OwnerDirectory;
  newId: () => string;
  now: () => Date;
  logger: Logger;
  onProvisioningIncomplete: () => void;
}

const MAX_OWNER_RACE_RETRIES = 2;

function mapStoreError(e: unknown): never {
  if (e instanceof SlugTakenError)
    throw new ApiError(409, 'slug_taken', 'This slug is already in use.');
  if (e instanceof OwnerExistsError || e instanceof NotProvisioningError) {
    throw new ApiError(409, 'tenant_already_exists', 'This user already owns a tenant.');
  }
  if (e instanceof TransactionConflictError) {
    throw new ApiError(503, 'try_again', 'The service is busy. Try again.');
  }
  throw e;
}

async function activate(deps: CreateTenantDeps, tenant: TenantRecord): Promise<TenantRecord> {
  try {
    await deps.directory.setOwnerClaims(tenant.ownerId, tenant.id);
    await deps.repository.activate(tenant.id);
  } catch (e) {
    // Either step can fail; both leave a `provisioning` tenant that a repeated call completes.
    deps.logger.error('provisioning incomplete', {
      tenantId: tenant.id,
      errorName: e instanceof Error ? e.name : 'unknown',
    });
    deps.onProvisioningIncomplete();
    throw new ApiError(503, 'provisioning_incomplete', 'Setup is not finished. Try again.');
  }
  deps.logger.info('tenant active', { tenantId: tenant.id });
  return { ...tenant, status: 'active' };
}

/** ADR-0007: identity first, tenant second. Safe to repeat until the tenant is active. */
export async function createTenant(
  deps: CreateTenantDeps,
  userId: string,
  input: CreateTenantRequest,
): Promise<TenantRecord> {
  try {
    for (let attempt = 0; attempt <= MAX_OWNER_RACE_RETRIES; attempt++) {
      const existingId = await deps.repository.findOwnerTenantId(userId);

      if (existingId !== undefined) {
        const existing = await deps.repository.getTenant(existingId);
        if (existing === undefined) throw new Error('owner item points to a missing tenant');
        if (existing.status === 'active') {
          throw new ApiError(409, 'tenant_already_exists', 'This user already owns a tenant.');
        }
        if (
          existing.slug !== input.slug ||
          existing.name !== input.name ||
          existing.timeZone !== input.timeZone
        ) {
          await deps.repository.updateProvisioning(existing, input);
        }
        return await activate(deps, { ...existing, ...input });
      }

      const tenant: TenantRecord = {
        id: deps.newId(),
        name: input.name,
        slug: input.slug,
        timeZone: input.timeZone,
        status: 'provisioning',
        ownerId: userId,
        createdAt: deps.now().toISOString(),
      };
      try {
        await deps.repository.createProvisioning(tenant);
      } catch (e) {
        // A parallel request of the same user won the owner item; look again.
        if (e instanceof OwnerExistsError) continue;
        throw e;
      }
      return await activate(deps, tenant);
    }
    throw new ApiError(409, 'tenant_already_exists', 'This user already owns a tenant.');
  } catch (e) {
    return mapStoreError(e);
  }
}
