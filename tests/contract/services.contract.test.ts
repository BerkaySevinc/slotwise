// Checks that what the catalog handler really returns matches api/openapi.yaml: the status code is
// documented for the operation, a success body fits the documented schema, and an error code
// appears in the documented examples. It runs the handler in memory; API Gateway's own responses
// (401 from the authorizer, 429) are not covered.
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildHandler } from '../../backend/functions/catalog-api/src/app.js';
import { makeDeps } from '../../backend/functions/catalog-api/src/testing.js';
import {
  TENANT_A,
  TENANT_B,
  apiEvent,
  ownerOf,
  staffOf,
  type EventOptions,
} from '../helpers/api-event.js';

interface Doc {
  components: { schemas: Record<string, unknown>; responses: Record<string, unknown> };
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
}

const doc = parse(readFileSync(new URL('../../api/openapi.yaml', import.meta.url), 'utf8')) as Doc;

const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema({ $id: 'openapi', components: doc.components });
const validator = (name: string) => ajv.compile({ $ref: `openapi#/components/schemas/${name}` });

type Json = Record<string, unknown>;

function resolve(response: unknown): Json {
  const r = response as Json;
  const ref = r['$ref'];
  return typeof ref === 'string'
    ? (doc.components.responses[ref.split('/').pop() ?? ''] as Json)
    : r;
}

/** Error codes shown in the examples of a documented response. */
function documentedCodes(response: Json): string[] {
  const media = (response['content'] as Json | undefined)?.['application/json'] as Json | undefined;
  if (media === undefined) return [];
  const examples = [
    ...(media['example'] === undefined ? [] : [media['example']]),
    ...Object.values((media['examples'] as Json | undefined) ?? {}).map(
      (e) => (e as Json)['value'],
    ),
  ];
  return examples.map((e) => (e as Json)['code'] as string);
}

const OPERATIONS: Record<string, [path: string, method: string]> = {
  'POST /services': ['/services', 'post'],
  'GET /services': ['/services', 'get'],
  'GET /services/{serviceId}': ['/services/{serviceId}', 'get'],
  'PATCH /services/{serviceId}': ['/services/{serviceId}', 'patch'],
};

const good = { name: 'Haircut', durationMinutes: 30, bufferMinutes: 10, priceMinor: 25050 };

async function scenarioApp() {
  const deps = makeDeps();
  const app = buildHandler(deps);
  const created = await app(
    apiEvent({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body: good }),
  );
  const id = (JSON.parse(created.body ?? '{}') as { id: string }).id;
  for (let i = 0; i < 2; i++) {
    await app(apiEvent({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body: good }));
  }
  return { app, id };
}

const withId = (id: string) => ({ serviceId: id });

const scenarios: [string, (id: string) => EventOptions][] = [
  ['created', () => ({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body: good })],
  [
    'create: malformed body',
    () => ({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body: '{' }),
  ],
  [
    'create: null body',
    () => ({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body: 'null' }),
  ],
  [
    'create: unknown property',
    () => ({
      routeKey: 'POST /services',
      caller: ownerOf(TENANT_A),
      body: { ...good, tenantId: TENANT_B },
    }),
  ],
  [
    'create: sum too long',
    () => ({
      routeKey: 'POST /services',
      caller: ownerOf(TENANT_A),
      body: { ...good, durationMinutes: 480, bufferMinutes: 5 },
    }),
  ],
  ['create: staff', () => ({ routeKey: 'POST /services', caller: staffOf(TENANT_A), body: good })],
  ['create: no tenant', () => ({ routeKey: 'POST /services', caller: { sub: 'new' }, body: good })],
  ['list', () => ({ routeKey: 'GET /services', caller: ownerOf(TENANT_A), query: { limit: '2' } })],
  [
    'list: includeInactive',
    () => ({
      routeKey: 'GET /services',
      caller: staffOf(TENANT_A),
      query: { includeInactive: 'true' },
    }),
  ],
  [
    'list: bad limit',
    () => ({ routeKey: 'GET /services', caller: ownerOf(TENANT_A), query: { limit: '500' } }),
  ],
  [
    'list: bad token',
    () => ({ routeKey: 'GET /services', caller: ownerOf(TENANT_A), query: { nextToken: 'zzz' } }),
  ],
  ['list: no tenant', () => ({ routeKey: 'GET /services', caller: { sub: 'new' } })],
  [
    'get',
    (id) => ({
      routeKey: 'GET /services/{serviceId}',
      caller: staffOf(TENANT_A),
      pathParameters: withId(id),
    }),
  ],
  [
    'get: other tenant',
    (id) => ({
      routeKey: 'GET /services/{serviceId}',
      caller: ownerOf(TENANT_B),
      pathParameters: withId(id),
    }),
  ],
  [
    'get: no tenant',
    (id) => ({
      routeKey: 'GET /services/{serviceId}',
      caller: { sub: 'new' },
      pathParameters: withId(id),
    }),
  ],
  [
    'update',
    (id) => ({
      routeKey: 'PATCH /services/{serviceId}',
      caller: ownerOf(TENANT_A),
      pathParameters: withId(id),
      body: { active: false },
    }),
  ],
  [
    'update: empty',
    (id) => ({
      routeKey: 'PATCH /services/{serviceId}',
      caller: ownerOf(TENANT_A),
      pathParameters: withId(id),
      body: {},
    }),
  ],
  [
    'update: other tenant',
    (id) => ({
      routeKey: 'PATCH /services/{serviceId}',
      caller: ownerOf(TENANT_B),
      pathParameters: withId(id),
      body: { active: false },
    }),
  ],
  [
    'update: staff',
    (id) => ({
      routeKey: 'PATCH /services/{serviceId}',
      caller: staffOf(TENANT_A),
      pathParameters: withId(id),
      body: { active: false },
    }),
  ],
  [
    'update: sum too long',
    (id) => ({
      routeKey: 'PATCH /services/{serviceId}',
      caller: ownerOf(TENANT_A),
      pathParameters: withId(id),
      body: { durationMinutes: 480 },
    }),
  ],
];

describe('the catalog API matches api/openapi.yaml', () => {
  it.each(scenarios)('%s', async (_name, makeEvent) => {
    const { app, id } = await scenarioApp();
    const options = makeEvent(id);
    const res = await app(apiEvent(options));
    const [path, method] = OPERATIONS[options.routeKey] ?? ['', ''];
    const documented = doc.paths[path]?.[method]?.responses ?? {};

    const status = String(res.statusCode);
    expect(Object.keys(documented), `status ${status} is documented`).toContain(status);

    const body = JSON.parse(res.body ?? 'null') as Json;
    if (status.startsWith('2')) {
      const schema =
        status === '200' && options.routeKey === 'GET /services' ? 'ServiceList' : 'Service';
      const validate = validator(schema);
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    } else {
      expect(validator('Error')(body)).toBe(true);
      expect(
        documentedCodes(resolve(documented[status])),
        `code ${String(body['code'])}`,
      ).toContain(body['code']);
    }
  });
});
