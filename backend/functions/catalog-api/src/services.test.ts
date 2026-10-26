import { describe, expect, it } from 'vitest';
import { ServiceMissingError, StaleServiceError } from './services.js';
import { createService, getService, listServices, updateService } from './services.js';
import { makeDeps } from './testing.js';

const A = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const B = '01JBBBBBBBBBBBBBBBBBBBBBBB';
const input = { name: 'Haircut', durationMinutes: 30, bufferMinutes: 10, priceMinor: 25050 };
const query = { includeInactive: false, limit: 50 };

const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e as { code?: string }).code ?? 'error',
  );

describe('createService', () => {
  it('stores an active service with a server-made id and time', async () => {
    const deps = makeDeps();
    const s = await createService(deps, A, input);
    expect(s).toEqual({
      ...input,
      id: expect.any(String) as string,
      active: true,
      createdAt: '2026-10-23T10:00:00.000Z',
    });
    expect(await getService(deps, A, s.id)).toEqual(s);
  });
});

describe('tenant isolation', () => {
  it('never shows, reads or changes a service of another tenant (AC-03.18)', async () => {
    const deps = makeDeps();
    const s = await createService(deps, A, input);
    expect(await code(getService(deps, B, s.id))).toBe('not_found');
    expect(await code(updateService(deps, B, s.id, { priceMinor: 1 }))).toBe('not_found');
    expect((await listServices(deps, B, query)).items).toEqual([]);
    expect((await getService(deps, A, s.id)).priceMinor).toBe(25050);
  });
});

describe('listServices', () => {
  async function seeded(count: number) {
    const deps = makeDeps();
    for (let i = 0; i < count; i++)
      await createService(deps, A, { ...input, name: `S${String(i)}` });
    return deps;
  }

  it('pages through every service exactly once', async () => {
    const deps = await seeded(5);
    const seen: string[] = [];
    let nextToken: string | undefined;
    do {
      const page = await listServices(deps, A, {
        ...query,
        limit: 2,
        ...(nextToken && { nextToken }),
      });
      seen.push(...page.items.map((s) => s.name));
      nextToken = page.nextToken;
    } while (nextToken !== undefined);
    expect(seen).toEqual(['S0', 'S1', 'S2', 'S3', 'S4']);
  });

  it('has no token on the last page, also when it is exactly full', async () => {
    const deps = await seeded(4);
    const first = await listServices(deps, A, { ...query, limit: 2 });
    const second = await listServices(deps, A, {
      ...query,
      limit: 2,
      nextToken: first.nextToken ?? '',
    });
    expect(second.items).toHaveLength(2);
    expect(second.nextToken).toBeUndefined();
  });

  it('hides retired services unless asked', async () => {
    const deps = await seeded(3);
    const all = (await listServices(deps, A, query)).items;
    await updateService(deps, A, all[1]?.id ?? '', { active: false });
    expect((await listServices(deps, A, query)).items.map((s) => s.name)).toEqual(['S0', 'S2']);
    const withInactive = await listServices(deps, A, { ...query, includeInactive: true });
    expect(withInactive.items.map((s) => s.name)).toEqual(['S0', 'S1', 'S2']);
  });

  it('refuses a token from another tenant', async () => {
    const deps = await seeded(3);
    const other = makeDeps();
    for (let i = 0; i < 3; i++) await createService(other, B, input);
    const token = (await listServices(other, B, { ...query, limit: 1 })).nextToken ?? '';
    expect(await code(listServices(deps, A, { ...query, nextToken: token }))).toBe(
      'invalid_page_token',
    );
  });
});

describe('updateService', () => {
  it('changes only what is sent', async () => {
    const deps = makeDeps();
    const s = await createService(deps, A, input);
    const updated = await updateService(deps, A, s.id, { priceMinor: 30000 });
    expect(updated).toEqual({ ...s, priceMinor: 30000 });
  });

  it('retires and restores', async () => {
    const deps = makeDeps();
    const s = await createService(deps, A, input);
    expect((await updateService(deps, A, s.id, { active: false })).active).toBe(false);
    expect((await getService(deps, A, s.id)).active).toBe(false);
    expect((await updateService(deps, A, s.id, { active: true })).active).toBe(true);
  });

  it('checks duration plus buffer on the merged values (AC-03.11)', async () => {
    const deps = makeDeps();
    const s = await createService(deps, A, { ...input, durationMinutes: 450, bufferMinutes: 0 });
    await expect(updateService(deps, A, s.id, { bufferMinutes: 35 })).rejects.toMatchObject({
      statusCode: 400,
      details: [{ field: 'bufferMinutes', issue: 'duration_plus_buffer_too_long' }],
    });
    await expect(
      updateService(deps, A, s.id, { durationMinutes: 480, bufferMinutes: 5 }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await getService(deps, A, s.id)).bufferMinutes).toBe(0);
  });

  it('returns 404 for an unknown service', async () => {
    expect(
      await code(updateService(makeDeps(), A, '01JNOSUCH0000000000000000', { active: false })),
    ).toBe('not_found');
  });

  it('retries once when a concurrent update changed the duration or buffer', async () => {
    const deps = makeDeps();
    const s = await createService(deps, A, { ...input, durationMinutes: 400, bufferMinutes: 0 });
    // Another writer sets the duration to 450 between our read and our write.
    deps.repository.beforeUpdate = () => {
      const stored = deps.repository.services.get(A)?.get(s.id);
      if (stored) stored.durationMinutes = 450;
    };
    await expect(updateService(deps, A, s.id, { bufferMinutes: 60 })).rejects.toMatchObject({
      statusCode: 400,
      details: [{ field: 'bufferMinutes', issue: 'duration_plus_buffer_too_long' }],
    });
    expect((await getService(deps, A, s.id)).bufferMinutes).toBe(0);
  });

  it('answers 503 try_again when the service keeps changing', async () => {
    const deps = makeDeps();
    const s = await createService(deps, A, input);
    deps.repository.update = () => Promise.reject(new StaleServiceError());
    expect(await code(updateService(deps, A, s.id, { durationMinutes: 45 }))).toBe('try_again');
  });

  it('answers 404 when the service vanishes between read and write', async () => {
    const deps = makeDeps();
    const s = await createService(deps, A, input);
    deps.repository.update = () => Promise.reject(new ServiceMissingError());
    expect(await code(updateService(deps, A, s.id, { name: 'x' }))).toBe('not_found');
  });
});
