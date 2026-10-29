import { describe, expect, it } from 'vitest';
import { makeCatalog } from '../testing.js';
import { createStaff, getStaff, listStaff, updateStaff } from './staff.js';

const A = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const B = '01JBBBBBBBBBBBBBBBBBBBBBBB';
const query = { includeInactive: false, limit: 50 };

const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e as { code?: string }).code ?? 'error',
  );

describe('createStaff', () => {
  it('stores an active member with a server-made id and time', async () => {
    const { staff } = makeCatalog();
    const m = await createStaff(staff, A, { name: 'Ahmet' });
    expect(m).toEqual({
      id: expect.any(String) as string,
      name: 'Ahmet',
      active: true,
      createdAt: '2026-10-23T10:00:00.000Z',
    });
    expect(await getStaff(staff, A, m.id)).toEqual(m);
  });

  it('allows two members with the same name', async () => {
    const { staff } = makeCatalog();
    const one = await createStaff(staff, A, { name: 'Ahmet' });
    const two = await createStaff(staff, A, { name: 'Ahmet' });
    expect(one.id).not.toBe(two.id);
  });
});

describe('tenant isolation', () => {
  it('never shows, reads or changes staff of another tenant (AC-04.21)', async () => {
    const { staff } = makeCatalog();
    const m = await createStaff(staff, A, { name: 'Ahmet' });
    expect(await code(getStaff(staff, B, m.id))).toBe('not_found');
    expect(await code(updateStaff(staff, B, m.id, { active: false }))).toBe('not_found');
    expect((await listStaff(staff, B, query)).items).toEqual([]);
    expect((await getStaff(staff, A, m.id)).active).toBe(true);
  });

  it('only knows the staff of the tenant it is asked about', async () => {
    const { staff } = makeCatalog();
    const m = await createStaff(staff, A, { name: 'Ahmet' });
    expect(await staff.repository.existingIds(A, [m.id, 'nope'])).toEqual(new Set([m.id]));
    expect(await staff.repository.existingIds(B, [m.id])).toEqual(new Set());
  });
});

describe('listStaff', () => {
  async function seeded(count: number) {
    const catalog = makeCatalog();
    for (let i = 0; i < count; i++) await createStaff(catalog.staff, A, { name: `M${String(i)}` });
    return catalog.staff;
  }

  it('pages through every member exactly once', async () => {
    const deps = await seeded(5);
    const seen: string[] = [];
    let nextToken: string | undefined;
    do {
      const page = await listStaff(deps, A, {
        ...query,
        limit: 2,
        ...(nextToken && { nextToken }),
      });
      seen.push(...page.items.map((s) => s.name));
      nextToken = page.nextToken;
    } while (nextToken !== undefined);
    expect(seen).toEqual(['M0', 'M1', 'M2', 'M3', 'M4']);
  });

  it('hides retired members unless asked', async () => {
    const deps = await seeded(3);
    const all = (await listStaff(deps, A, query)).items;
    await updateStaff(deps, A, all[1]?.id ?? '', { active: false });
    expect((await listStaff(deps, A, query)).items.map((s) => s.name)).toEqual(['M0', 'M2']);
    const withInactive = await listStaff(deps, A, { ...query, includeInactive: true });
    expect(withInactive.items.map((s) => s.name)).toEqual(['M0', 'M1', 'M2']);
  });

  it('refuses a token from another tenant', async () => {
    const deps = await seeded(3);
    const other = makeCatalog();
    for (let i = 0; i < 3; i++) await createStaff(other.staff, B, { name: 'x' });
    const token = (await listStaff(other.staff, B, { ...query, limit: 1 })).nextToken ?? '';
    expect(await code(listStaff(deps, A, { ...query, nextToken: token }))).toBe(
      'invalid_page_token',
    );
  });
});

describe('updateStaff', () => {
  it('changes only what is sent', async () => {
    const { staff } = makeCatalog();
    const m = await createStaff(staff, A, { name: 'Ahmet' });
    expect(await updateStaff(staff, A, m.id, { name: 'Mehmet' })).toEqual({ ...m, name: 'Mehmet' });
  });

  it('retires and restores', async () => {
    const { staff } = makeCatalog();
    const m = await createStaff(staff, A, { name: 'Ahmet' });
    expect((await updateStaff(staff, A, m.id, { active: false })).active).toBe(false);
    expect((await getStaff(staff, A, m.id)).active).toBe(false);
    expect((await updateStaff(staff, A, m.id, { active: true })).active).toBe(true);
  });

  it('returns 404 for an unknown member', async () => {
    const { staff } = makeCatalog();
    expect(await code(updateStaff(staff, A, 'nope', { active: false }))).toBe('not_found');
  });

  it('retiring a member leaves the services that list them untouched (AC-04.18)', async () => {
    const { staff, services, serviceRepository } = makeCatalog();
    const m = await createStaff(staff, A, { name: 'Ahmet' });
    await serviceRepository.create(A, {
      id: '0000000000000000000000S001',
      name: 'Cut',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceMinor: 1,
      active: true,
      staffIds: [m.id],
      createdAt: '2026-10-23T10:00:00.000Z',
    });
    await updateStaff(staff, A, m.id, { active: false });
    const service = await services.repository.get(A, '0000000000000000000000S001');
    expect(service?.staffIds).toEqual([m.id]);
  });
});
