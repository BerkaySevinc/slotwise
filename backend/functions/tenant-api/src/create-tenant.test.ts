import { describe, expect, it } from 'vitest';
import { createTenant } from './create-tenant.js';
import { makeDeps } from './testing.js';

const input = { name: 'Ahmet Berber', slug: 'ahmet-berber', timeZone: 'Europe/Istanbul' };

async function code(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe('createTenant', () => {
  it('creates an active tenant and sets the owner claims', async () => {
    const claims: [string, string][] = [];
    const deps = makeDeps({
      directory: {
        setOwnerClaims: (u, t) => {
          claims.push([u, t]);
          return Promise.resolve();
        },
      },
    });
    const tenant = await createTenant(deps, 'user-1', input);

    expect(tenant).toMatchObject({ ...input, status: 'active', ownerId: 'user-1' });
    expect(tenant.createdAt).toBe('2026-10-21T10:00:00.000Z');
    expect(claims).toEqual([['user-1', tenant.id]]);
    expect(deps.repository.tenants.get(tenant.id)?.status).toBe('active');
  });

  it('returns 409 slug_taken when another user holds the slug, in any state', async () => {
    const deps = makeDeps();
    await createTenant(deps, 'user-1', input);
    expect(await code(createTenant(deps, 'user-2', input))).toBe('slug_taken');
    expect(deps.repository.owners.has('user-2')).toBe(false);
    expect(deps.repository.tenants.size).toBe(1);
  });

  it('returns 409 tenant_already_exists for a user with an active tenant', async () => {
    const deps = makeDeps();
    await createTenant(deps, 'user-1', input);
    const other = { ...input, slug: 'other-shop' };
    expect(await code(createTenant(deps, 'user-1', other))).toBe('tenant_already_exists');
    expect(deps.repository.slugs.has('other-shop')).toBe(false);
  });

  describe('Cognito failure', () => {
    it('returns 503, keeps the tenant provisioning and emits the metric', async () => {
      const deps = makeDeps({
        directory: { setOwnerClaims: () => Promise.reject(new Error('x')) },
      });
      expect(await code(createTenant(deps, 'user-1', input))).toBe('provisioning_incomplete');
      expect([...deps.repository.tenants.values()]).toMatchObject([{ status: 'provisioning' }]);
      expect(deps.repository.owners.has('user-1')).toBe(true);
      expect(deps.incomplete.count).toBe(1);
    });

    it('is completed by a repeated call without creating a second tenant', async () => {
      let failing = true;
      const deps = makeDeps({
        directory: {
          setOwnerClaims: () => (failing ? Promise.reject(new Error('x')) : Promise.resolve()),
        },
      });
      await code(createTenant(deps, 'user-1', input));
      failing = false;
      const tenant = await createTenant(deps, 'user-1', input);

      expect(tenant.status).toBe('active');
      expect(deps.repository.tenants.size).toBe(1);
      expect(deps.repository.tenants.get(tenant.id)?.status).toBe('active');
    });

    it('lets the retry change the slug and releases the old one', async () => {
      let failing = true;
      const deps = makeDeps({
        directory: {
          setOwnerClaims: () => (failing ? Promise.reject(new Error('x')) : Promise.resolve()),
        },
      });
      await code(createTenant(deps, 'user-1', input));
      failing = false;
      const tenant = await createTenant(deps, 'user-1', { ...input, slug: 'new-slug' });

      expect(tenant.slug).toBe('new-slug');
      expect([...deps.repository.slugs.keys()]).toEqual(['new-slug']);
      expect(deps.repository.tenants.get(tenant.id)?.slug).toBe('new-slug');
    });

    it('keeps the old slug when the new one is taken', async () => {
      let failing = true;
      const deps = makeDeps({
        directory: {
          setOwnerClaims: () => (failing ? Promise.reject(new Error('x')) : Promise.resolve()),
        },
      });
      await createTenant(
        { ...deps, directory: { setOwnerClaims: () => Promise.resolve() } },
        'user-2',
        {
          ...input,
          slug: 'taken-one',
        },
      );
      await code(createTenant(deps, 'user-1', input));
      failing = false;

      expect(await code(createTenant(deps, 'user-1', { ...input, slug: 'taken-one' }))).toBe(
        'slug_taken',
      );
      expect(deps.repository.slugs.get(input.slug)).toBeDefined();
      expect(
        [...deps.repository.tenants.values()].find((t) => t.ownerId === 'user-1'),
      ).toMatchObject({ slug: input.slug, status: 'provisioning' });
    });
  });

  it('returns 503 when the activation write fails, and a repeated call completes it', async () => {
    const deps = makeDeps();
    const realActivate = deps.repository.activate.bind(deps.repository);
    let failing = true;
    deps.repository.activate = (id) =>
      failing ? Promise.reject(new Error('x')) : realActivate(id);

    expect(await code(createTenant(deps, 'user-1', input))).toBe('provisioning_incomplete');
    expect(deps.incomplete.count).toBe(1);
    expect([...deps.repository.tenants.values()]).toMatchObject([{ status: 'provisioning' }]);

    failing = false;
    const tenant = await createTenant(deps, 'user-1', input);
    expect(tenant.status).toBe('active');
    expect(deps.repository.tenants.size).toBe(1);
  });

  it('treats a lost owner-item race as a retry', async () => {
    const deps = makeDeps();
    const original = deps.repository.findOwnerTenantId.bind(deps.repository);
    let first = true;
    deps.repository.findOwnerTenantId = async (userId) => {
      // Simulates a parallel request of the same user finishing between read and write.
      if (first) {
        first = false;
        await createTenant(makeDepsSharing(deps), userId, input);
        return undefined;
      }
      return original(userId);
    };
    expect(await code(createTenant(deps, 'user-1', { ...input, slug: 'second-try' }))).toBe(
      'tenant_already_exists',
    );
    expect(deps.repository.tenants.size).toBe(1);
  });
});

function makeDepsSharing(deps: ReturnType<typeof makeDeps>): ReturnType<typeof makeDeps> {
  return { ...deps, newId: () => 'RACEWINNER00000000000000A0' };
}
