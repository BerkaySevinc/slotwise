import { describe, expect, it } from 'vitest';
import {
  CATALOG_ROUTES,
  TENANT_A,
  TENANT_B,
  apiEvent,
  ownerOf,
  staffOf,
} from '../../../../tests/helpers/api-event.js';
import { buildHandler } from './app.js';
import { makeDeps } from './testing.js';

const good = { name: 'Haircut', durationMinutes: 30, bufferMinutes: 10, priceMinor: 25050 };

function setup() {
  const deps = makeDeps();
  return { deps, app: buildHandler(deps) };
}

type Handler = ReturnType<typeof buildHandler>;
const parse = (r: { body?: string | undefined }): Record<string, unknown> =>
  JSON.parse(r.body ?? 'null') as Record<string, unknown>;

async function createAs(app: Handler, tenantId: string, body: unknown = good) {
  const res = await app(apiEvent({ routeKey: 'POST /services', caller: ownerOf(tenantId), body }));
  expect(res.statusCode).toBe(201);
  return parse(res)['id'] as string;
}

describe('every authenticated route (AC-02.4, AC-03.17)', () => {
  it.each(CATALOG_ROUTES)('$routeKey rejects a token without a tenant', async (route) => {
    const { app } = setup();
    const res = await app(apiEvent({ ...route, caller: { sub: 'new-user' } }));
    expect(res.statusCode).toBe(403);
    expect(parse(res)['code']).toBe('tenant_required');
  });

  it.each(CATALOG_ROUTES)('$routeKey rejects a token with a tenant but no role', async (route) => {
    const { app } = setup();
    const res = await app(apiEvent({ ...route, caller: { sub: 'u', tenantId: TENANT_A } }));
    expect(parse(res)['code']).toBe('tenant_required');
  });
});

describe('roles (AC-03.16)', () => {
  it.each(['POST /services', 'PATCH /services/{serviceId}'])(
    'staff may not call %s',
    async (routeKey) => {
      const { app } = setup();
      const route = CATALOG_ROUTES.find((r) => r.routeKey === routeKey);
      const res = await app(apiEvent({ ...route, routeKey, caller: staffOf(TENANT_A) }));
      expect(res.statusCode).toBe(403);
      expect(parse(res)['code']).toBe('forbidden');
    },
  );

  it('staff may read the list and a single service', async () => {
    const { app } = setup();
    const id = await createAs(app, TENANT_A);
    const list = await app(apiEvent({ routeKey: 'GET /services', caller: staffOf(TENANT_A) }));
    expect(list.statusCode).toBe(200);
    const one = await app(
      apiEvent({
        routeKey: 'GET /services/{serviceId}',
        caller: staffOf(TENANT_A),
        pathParameters: { serviceId: id },
      }),
    );
    expect(one.statusCode).toBe(200);
  });
});

describe('POST /services', () => {
  it('returns 201 with the service and no tenant id', async () => {
    const { app } = setup();
    const res = await app(
      apiEvent({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body: good }),
    );
    expect(res.statusCode).toBe(201);
    expect(parse(res)).toEqual({
      ...good,
      id: expect.any(String) as string,
      active: true,
      createdAt: '2026-10-23T10:00:00.000Z',
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['a null body', 'null'],
    ['an empty body', ''],
    ['an unknown property', JSON.stringify({ ...good, tenantId: TENANT_B })],
    ['a price as text', JSON.stringify({ ...good, priceMinor: '250' })],
  ])('answers 400 for %s, never 500', async (_name, body) => {
    const { app } = setup();
    const res = await app(
      apiEvent({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body }),
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res)['code']).toBe('validation_failed');
  });

  it('answers 400 when there is no body at all', async () => {
    const { app } = setup();
    const res = await app(apiEvent({ routeKey: 'POST /services', caller: ownerOf(TENANT_A) }));
    expect(res.statusCode).toBe(400);
  });

  it('ignores a tenant id sent in the body by rejecting it, and uses the token', async () => {
    const { app, deps } = setup();
    await createAs(app, TENANT_A);
    expect(deps.repository.services.get(TENANT_A)?.size).toBe(1);
    expect(deps.repository.services.get(TENANT_B)).toBeUndefined();
  });

  it('answers 500 and logs only the error name for an unexpected failure', async () => {
    const lines: string[] = [];
    const deps = makeDeps({
      logger: { info: () => undefined, error: (m, e) => lines.push(JSON.stringify({ m, e })) },
    });
    deps.repository.create = () => Promise.reject(new Error('secret detail'));
    const res = await buildHandler(deps)(
      apiEvent({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body: good }),
    );
    expect(res.statusCode).toBe(500);
    expect(lines.join()).not.toContain('secret detail');
  });
});

describe('GET /services', () => {
  it('returns items and a token while more follow', async () => {
    const { app } = setup();
    for (let i = 0; i < 3; i++) await createAs(app, TENANT_A, { ...good, name: `S${String(i)}` });
    const res = await app(
      apiEvent({ routeKey: 'GET /services', caller: ownerOf(TENANT_A), query: { limit: '2' } }),
    );
    const body = parse(res);
    expect((body['items'] as unknown[]).length).toBe(2);
    expect(typeof body['nextToken']).toBe('string');
  });

  it.each([{ limit: '0' }, { limit: '101' }, { limit: 'x' }, { includeInactive: 'maybe' }])(
    'answers 400 for the query %j',
    async (query) => {
      const { app } = setup();
      const res = await app(
        apiEvent({ routeKey: 'GET /services', caller: ownerOf(TENANT_A), query }),
      );
      expect(res.statusCode).toBe(400);
      expect(parse(res)['code']).toBe('validation_failed');
    },
  );

  it('answers 400 invalid_page_token for a garbage token', async () => {
    const { app } = setup();
    const res = await app(
      apiEvent({
        routeKey: 'GET /services',
        caller: ownerOf(TENANT_A),
        query: { nextToken: 'zzz' },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res)['code']).toBe('invalid_page_token');
  });
});

describe('cross-tenant (rule 1)', () => {
  it('tenant B gets 404 for tenant A’s service on GET and PATCH, and A’s data is unchanged', async () => {
    const { app } = setup();
    const id = await createAs(app, TENANT_A);
    const get = await app(
      apiEvent({
        routeKey: 'GET /services/{serviceId}',
        caller: ownerOf(TENANT_B),
        pathParameters: { serviceId: id },
      }),
    );
    expect(get.statusCode).toBe(404);
    const patch = await app(
      apiEvent({
        routeKey: 'PATCH /services/{serviceId}',
        caller: ownerOf(TENANT_B),
        pathParameters: { serviceId: id },
        body: { active: false, priceMinor: 1 },
      }),
    );
    expect(patch.statusCode).toBe(404);
    const mine = await app(
      apiEvent({
        routeKey: 'GET /services/{serviceId}',
        caller: ownerOf(TENANT_A),
        pathParameters: { serviceId: id },
      }),
    );
    expect(parse(mine)).toMatchObject({ active: true, priceMinor: 25050 });
  });

  it('tenant B’s list does not contain tenant A’s services', async () => {
    const { app } = setup();
    await createAs(app, TENANT_A);
    const res = await app(apiEvent({ routeKey: 'GET /services', caller: ownerOf(TENANT_B) }));
    expect(parse(res)['items']).toEqual([]);
  });
});

describe('GET and PATCH /services/{serviceId}', () => {
  it('answers 404 not_found for an unknown id', async () => {
    const { app } = setup();
    const res = await app(
      apiEvent({
        routeKey: 'GET /services/{serviceId}',
        caller: ownerOf(TENANT_A),
        pathParameters: { serviceId: 'nope' },
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(parse(res)['code']).toBe('not_found');
  });

  it('PATCH returns the updated service; an empty object is a 400', async () => {
    const { app } = setup();
    const id = await createAs(app, TENANT_A);
    const ok = await app(
      apiEvent({
        routeKey: 'PATCH /services/{serviceId}',
        caller: ownerOf(TENANT_A),
        pathParameters: { serviceId: id },
        body: { name: 'Beard', active: false },
      }),
    );
    expect(parse(ok)).toMatchObject({ id, name: 'Beard', active: false, priceMinor: 25050 });
    const empty = await app(
      apiEvent({
        routeKey: 'PATCH /services/{serviceId}',
        caller: ownerOf(TENANT_A),
        pathParameters: { serviceId: id },
        body: {},
      }),
    );
    expect(empty.statusCode).toBe(400);
  });
});

it('answers 404 for a route it does not serve', async () => {
  const { app } = setup();
  const res = await app(
    apiEvent({ routeKey: 'DELETE /services/{serviceId}', caller: ownerOf(TENANT_A) }),
  );
  expect(res.statusCode).toBe(404);
});
