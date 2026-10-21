// Checks that what the POST /tenants handler really returns matches api/openapi.yaml: the status
// code is documented, the body fits the documented schema, and the error code appears in the
// documented examples. It runs the handler in memory; API Gateway's own responses (401 from the
// authorizer, 429) are not covered.
import { readFileSync } from 'node:fs';
import { IdempotencyAlreadyInProgressError } from '@aws-lambda-powertools/idempotency';
import { IdempotencyValidationError } from '@aws-lambda-powertools/idempotency';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildHandler, type AppDeps } from '../../backend/functions/tenant-api/src/app.js';
import { TransactionConflictError } from '../../backend/functions/tenant-api/src/create-tenant.js';
import { makeDeps } from '../../backend/functions/tenant-api/src/testing.js';

interface Doc {
  components: {
    schemas: Record<string, unknown>;
    responses: Record<string, unknown>;
  };
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
  if (typeof ref === 'string') {
    return doc.components.responses[ref.split('/').pop() ?? ''] as Json;
  }
  return r;
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

const documented = doc.paths['/tenants']?.['post']?.responses ?? {};

const goodBody = { name: 'Ahmet Berber', slug: 'ahmet-berber', timeZone: 'Europe/Istanbul' };

function event(
  over: { body?: string | undefined; key?: string | undefined } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    headers: over.key === undefined && 'key' in over ? {} : { 'idempotency-key': 'contract-0001' },
    body: 'body' in over ? over.body : JSON.stringify(goodBody),
    isBase64Encoded: false,
    requestContext: { authorizer: { jwt: { claims: { sub: 'user-1' }, scopes: null } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function app(over: Partial<AppDeps> = {}) {
  return buildHandler({ ...makeDeps(), makeIdempotent: (fn) => fn, ...over });
}

const scenarios: [
  string,
  () => Promise<{ statusCode?: number | undefined; body?: string | undefined }>,
][] = [
  ['created', () => app()(event())],
  ['malformed body', () => app()(event({ body: '{' }))],
  ['null body', () => app()(event({ body: 'null' }))],
  ['unknown property', () => app()(event({ body: JSON.stringify({ ...goodBody, role: 'x' }) }))],
  ['reserved slug', () => app()(event({ body: JSON.stringify({ ...goodBody, slug: 'admin' }) }))],
  ['missing Idempotency-Key', () => app()(event({ key: undefined }))],
  [
    'slug taken',
    async () => {
      const deps = makeDeps();
      const handler = buildHandler({ ...deps, makeIdempotent: (fn) => fn });
      await handler(event());
      const other = event();
      (other.requestContext.authorizer.jwt.claims as Record<string, string>)['sub'] = 'user-2';
      return handler(other);
    },
  ],
  [
    'tenant already exists',
    async () => {
      const handler = app();
      await handler(event());
      return handler(event({ body: JSON.stringify({ ...goodBody, slug: 'other-shop' }) }));
    },
  ],
  [
    'request in progress',
    () =>
      app({
        makeIdempotent: () => () =>
          Promise.reject(new IdempotencyAlreadyInProgressError('in progress')),
      })(event()),
  ],
  [
    'idempotency key mismatch',
    () =>
      app({
        makeIdempotent: () => () => Promise.reject(new IdempotencyValidationError('mismatch')),
      })(event()),
  ],
  [
    'provisioning incomplete',
    () => app({ directory: { setOwnerClaims: () => Promise.reject(new Error('x')) } })(event()),
  ],
  [
    'database busy',
    () =>
      app({
        repository: {
          findOwnerTenantId: () => Promise.resolve(undefined),
          createProvisioning: () => Promise.reject(new TransactionConflictError()),
        } as unknown as AppDeps['repository'],
      })(event()),
  ],
];

describe('POST /tenants responses match api/openapi.yaml', () => {
  it.each(scenarios)('%s', async (_name, run) => {
    const res = await run();
    const status = String(res.statusCode);
    expect(Object.keys(documented), `status ${status} is not documented`).toContain(status);

    const body = JSON.parse(res.body ?? 'null') as Json;
    if (status === '201') {
      const validate = validator('Tenant');
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
      expect(new Date(body['createdAt'] as string).toISOString()).toBe(body['createdAt']);
    } else {
      const validate = validator('Error');
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
      expect(
        documentedCodes(resolve(documented[status])),
        `code ${String(body['code'])}`,
      ).toContain(body['code']);
    }
  });

  it('the documented examples are valid against their own schemas', () => {
    const validate = validator('Error');
    for (const response of Object.values(documented)) {
      const media = (resolve(response)['content'] as Json | undefined)?.['application/json'] as
        Json | undefined;
      if (media === undefined) continue;
      const values = [
        media['example'],
        ...Object.values((media['examples'] as Json | undefined) ?? {}).map(
          (e) => (e as Json)['value'],
        ),
      ].filter((v) => v !== undefined);
      for (const value of values) {
        expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      }
    }
  });
});
