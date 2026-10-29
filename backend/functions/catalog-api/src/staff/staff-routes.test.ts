import { describe, expect, it } from 'vitest';
import {
  TENANT_A,
  TENANT_B,
  apiEvent,
  ownerOf,
  staffOf,
} from '../../../../../tests/helpers/api-event.js';
import { buildHandler } from '../app.js';
import { makeCatalog } from '../testing.js';

// The staff endpoints and the staffIds of services (US-04) through the router. Roles and the
// "no tenant" check for every route are in ../app.test.ts.
function setup() {
  const catalog = makeCatalog();
  return { catalog, app: buildHandler(catalog.app) };
}
type Handler = ReturnType<typeof buildHandler>;

const parse = (r: { body?: string | undefined }): Record<string, unknown> =>
  JSON.parse(r.body ?? 'null') as Record<string, unknown>;

const asOwner = (app: Handler, routeKey: string, extra: Record<string, unknown> = {}) =>
  app(apiEvent({ routeKey, caller: ownerOf(TENANT_A), ...extra }));

async function createMember(app: Handler, tenantId = TENANT_A, name = 'Ahmet') {
  const res = await app(
    apiEvent({ routeKey: 'POST /staff', caller: ownerOf(tenantId), body: { name } }),
  );
  expect(res.statusCode).toBe(201);
  return parse(res)['id'] as string;
}

describe('POST /staff', () => {
  it('returns 201 with the member and no tenant id', async () => {
    const { app } = setup();
    const res = await asOwner(app, 'POST /staff', { body: { name: ' Ahmet ' } });
    expect(res.statusCode).toBe(201);
    expect(parse(res)).toEqual({
      id: expect.any(String) as string,
      name: 'Ahmet',
      active: true,
      createdAt: '2026-10-23T10:00:00.000Z',
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['a null body', 'null'],
    ['an empty object', '{}'],
    ['a tenant id', JSON.stringify({ name: 'A', tenantId: TENANT_B })],
    ['contact data', JSON.stringify({ name: 'A', email: 'a@example.com' })],
    ['service ids', JSON.stringify({ name: 'A', serviceIds: [] })],
  ])('answers 400 for %s, never 500', async (_name, body) => {
    const { app } = setup();
    const res = await asOwner(app, 'POST /staff', { body });
    expect(res.statusCode).toBe(400);
    expect(parse(res)['code']).toBe('validation_failed');
  });

  it('lets staff read but not write (AC-04.19)', async () => {
    const { app } = setup();
    const id = await createMember(app);
    const caller = staffOf(TENANT_A);
    expect((await app(apiEvent({ routeKey: 'GET /staff', caller }))).statusCode).toBe(200);
    const one = await app(
      apiEvent({ routeKey: 'GET /staff/{staffId}', caller, pathParameters: { staffId: id } }),
    );
    expect(one.statusCode).toBe(200);
    const write = await app(apiEvent({ routeKey: 'POST /staff', caller, body: { name: 'x' } }));
    expect(write.statusCode).toBe(403);
  });
});

describe('GET /staff and GET /staff/{staffId}', () => {
  it('lists active members page by page and hides retired ones', async () => {
    const { app } = setup();
    const first = await createMember(app, TENANT_A, 'M0');
    await createMember(app, TENANT_A, 'M1');
    await createMember(app, TENANT_A, 'M2');
    await asOwner(app, 'PATCH /staff/{staffId}', {
      pathParameters: { staffId: first },
      body: { active: false },
    });
    const page = parse(await asOwner(app, 'GET /staff', { query: { limit: '1' } }));
    expect((page['items'] as { name: string }[]).map((m) => m.name)).toEqual(['M1']);
    expect(typeof page['nextToken']).toBe('string');
    const all = parse(await asOwner(app, 'GET /staff', { query: { includeInactive: 'true' } }));
    expect((all['items'] as unknown[]).length).toBe(3);
  });

  it.each([{ limit: '0' }, { limit: '101' }, { includeInactive: 'maybe' }])(
    'answers 400 for the query %j',
    async (query) => {
      const { app } = setup();
      expect((await asOwner(app, 'GET /staff', { query })).statusCode).toBe(400);
    },
  );

  it('refuses a garbage page token', async () => {
    const { app } = setup();
    const res = await asOwner(app, 'GET /staff', { query: { nextToken: 'zzz' } });
    expect(parse(res)['code']).toBe('invalid_page_token');
  });

  it('returns a retired member by id and 404 for an unknown one', async () => {
    const { app } = setup();
    const id = await createMember(app);
    await asOwner(app, 'PATCH /staff/{staffId}', {
      pathParameters: { staffId: id },
      body: { active: false },
    });
    const got = await asOwner(app, 'GET /staff/{staffId}', { pathParameters: { staffId: id } });
    expect(parse(got)).toMatchObject({ id, active: false });
    const missing = await asOwner(app, 'GET /staff/{staffId}', {
      pathParameters: { staffId: 'nope' },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('PATCH /staff/{staffId}', () => {
  it('changes the sent fields; an empty object or an unknown field is a 400', async () => {
    const { app } = setup();
    const id = await createMember(app);
    const ok = await asOwner(app, 'PATCH /staff/{staffId}', {
      pathParameters: { staffId: id },
      body: { name: 'Mehmet' },
    });
    expect(parse(ok)).toMatchObject({ id, name: 'Mehmet', active: true });
    for (const body of [{}, { tenantId: TENANT_B }]) {
      const bad = await asOwner(app, 'PATCH /staff/{staffId}', {
        pathParameters: { staffId: id },
        body,
      });
      expect(bad.statusCode).toBe(400);
    }
  });
});

describe('cross-tenant (rule 1)', () => {
  it('tenant B gets 404 for tenant A’s member, the list shows none, and A’s data is unchanged', async () => {
    const { app } = setup();
    const id = await createMember(app);
    const asB = { caller: ownerOf(TENANT_B), pathParameters: { staffId: id } };
    expect((await app(apiEvent({ routeKey: 'GET /staff/{staffId}', ...asB }))).statusCode).toBe(
      404,
    );
    const patch = await app(
      apiEvent({ routeKey: 'PATCH /staff/{staffId}', ...asB, body: { active: false, name: 'x' } }),
    );
    expect(patch.statusCode).toBe(404);
    const mine = await asOwner(app, 'GET /staff/{staffId}', { pathParameters: { staffId: id } });
    expect(parse(mine)).toMatchObject({ name: 'Ahmet', active: true });
    const list = await app(apiEvent({ routeKey: 'GET /staff', caller: ownerOf(TENANT_B) }));
    expect(parse(list)['items']).toEqual([]);
  });
});

describe('staffIds on services', () => {
  const service = (staffIds: unknown) => ({
    name: 'Haircut',
    durationMinutes: 30,
    priceMinor: 1,
    staffIds,
  });

  it('a service is created with its staff and every response shows them', async () => {
    const { app } = setup();
    const staff = await createMember(app);
    const created = await asOwner(app, 'POST /services', { body: service([staff]) });
    expect(created.statusCode).toBe(201);
    expect(parse(created)['staffIds']).toEqual([staff]);
    const id = parse(created)['id'] as string;
    const list = parse(await asOwner(app, 'GET /services'));
    expect((list['items'] as { staffIds: string[] }[])[0]?.staffIds).toEqual([staff]);
    const patched = await asOwner(app, 'PATCH /services/{serviceId}', {
      pathParameters: { serviceId: id },
      body: { staffIds: [] },
    });
    expect(parse(patched)['staffIds']).toEqual([]);
  });

  it('answers 400 unknown_staff for an unknown id and for another tenant’s member', async () => {
    const { app } = setup();
    const foreign = await createMember(app, TENANT_B, 'Other');
    for (const id of ['nope', foreign]) {
      const res = await asOwner(app, 'POST /services', { body: service([id]) });
      expect(res.statusCode).toBe(400);
      expect(parse(res)['details']).toEqual([{ field: 'staffIds', issue: 'unknown_staff' }]);
    }
  });

  it('answers 400 for a malformed staffIds', async () => {
    const { app } = setup();
    for (const bad of ['a', ['a', 'a'], [1]]) {
      const res = await asOwner(app, 'POST /services', { body: service(bad) });
      expect(res.statusCode).toBe(400);
    }
  });

  it('retiring a member leaves the services that list them untouched (AC-04.18)', async () => {
    const { app } = setup();
    const staff = await createMember(app);
    const svc = parse(await asOwner(app, 'POST /services', { body: service([staff]) }))[
      'id'
    ] as string;
    await asOwner(app, 'PATCH /staff/{staffId}', {
      pathParameters: { staffId: staff },
      body: { active: false },
    });
    const got = await asOwner(app, 'GET /services/{serviceId}', {
      pathParameters: { serviceId: svc },
    });
    expect(parse(got)['staffIds']).toEqual([staff]);
  });
});
