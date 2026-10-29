// Runs the catalog handler against a real DynamoDB table (the deployed dev stack), because the
// query, pagination, conditional update and cancellation behavior cannot be proven with fakes.
// Skipped unless SLOTWISE_DATA_TABLE is set.
//
//   AWS_PROFILE=slotwise SLOTWISE_DATA_TABLE=slotwise-dev-data npm test
//
// Each run uses two random tenant ids and deletes every item under them. The JWT authorizer and
// the Lambda bundle are not involved: the handler is called with the claims the authorizer would
// pass on.
import { randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { apiEvent, ownerOf, staffOf } from '../helpers/api-event.js';
import { realCatalogApp } from '../helpers/real-catalog-app.js';

const tableName = process.env['SLOTWISE_DATA_TABLE'];

// A tenant id is a ULID, so the random part comes from `ulid()`.
const TENANT_A = ulid();
const TENANT_B = ulid();

describe.skipIf(tableName === undefined)('services against DynamoDB', () => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const table = tableName ?? '';
  const run = randomBytes(2).toString('hex');
  const app = realCatalogApp(db, table);

  type Res = { statusCode?: number | undefined; body?: string | undefined };
  const json = (r: Res) => JSON.parse(r.body ?? 'null') as Record<string, unknown>;
  const body = (n: string, extra: Record<string, unknown> = {}) => ({
    name: `it-${run}-${n}`,
    durationMinutes: 30,
    bufferMinutes: 0,
    priceMinor: 25050,
    ...extra,
  });
  const create = async (tenantId: string, payload: Record<string, unknown>) => {
    const res = await app(
      apiEvent({ routeKey: 'POST /services', caller: ownerOf(tenantId), body: payload }),
    );
    expect(res.statusCode).toBe(201);
    return json(res)['id'] as string;
  };
  const get = (tenantId: string, id: string, caller = ownerOf(tenantId)) =>
    app(
      apiEvent({
        routeKey: 'GET /services/{serviceId}',
        caller,
        pathParameters: { serviceId: id },
      }),
    );
  const patch = (tenantId: string, id: string, payload: unknown) =>
    app(
      apiEvent({
        routeKey: 'PATCH /services/{serviceId}',
        caller: ownerOf(tenantId),
        pathParameters: { serviceId: id },
        body: payload,
      }),
    );
  const list = (tenantId: string, query: Record<string, string> = {}) =>
    app(apiEvent({ routeKey: 'GET /services', caller: ownerOf(tenantId), query }));

  afterAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      const out = await db.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `T#${tenantId}` },
          ProjectionExpression: 'PK, SK',
          ConsistentRead: true,
        }),
      );
      const keys = (out.Items ?? []).map((i) => ({ PK: i['PK'] as string, SK: i['SK'] as string }));
      for (let i = 0; i < keys.length; i += 25) {
        await db.send(
          new BatchWriteCommand({
            RequestItems: {
              [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
            },
          }),
        );
      }
    }
  });

  it('creates a service and reads it back (AC-03.6, AC-03.10)', async () => {
    const id = await create(TENANT_A, body('basic'));
    const res = await get(TENANT_A, id, staffOf(TENANT_A));
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ id, active: true, priceMinor: 25050, bufferMinutes: 0 });
  });

  it('pages through services and hides retired ones (AC-03.8, AC-03.9, AC-03.12)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await create(TENANT_B, body(`page-${String(i)}`)));
    await patch(TENANT_B, ids[1] ?? '', { active: false });

    const seen: string[] = [];
    let nextToken: string | undefined;
    let pages = 0;
    do {
      const res = await list(TENANT_B, { limit: '2', ...(nextToken && { nextToken }) });
      expect(res.statusCode).toBe(200);
      const page = json(res);
      seen.push(...(page['items'] as { id: string }[]).map((s) => s.id));
      nextToken = page['nextToken'] as string | undefined;
      pages++;
    } while (nextToken !== undefined);
    // Four active services in pages of two; the retired one is skipped, not counted.
    expect(seen).toEqual([ids[0], ids[2], ids[3], ids[4]]);
    expect(pages).toBe(2);

    const all = json(await list(TENANT_B, { includeInactive: 'true' }));
    expect((all['items'] as unknown[]).length).toBe(5);

    await patch(TENANT_B, ids[1] ?? '', { active: true });
    expect((json(await list(TENANT_B))['items'] as unknown[]).length).toBe(5);
  });

  it('changes only the fields sent, and a missing service is not created by a patch (AC-03.11, AC-03.13)', async () => {
    const id = await create(TENANT_A, body('patch'));
    const res = await patch(TENANT_A, id, { priceMinor: 1, name: `it-${run}-renamed` });
    expect(json(res)).toMatchObject({ id, priceMinor: 1, durationMinutes: 30, active: true });

    const ghost = ulid();
    expect((await patch(TENANT_A, ghost, { active: false })).statusCode).toBe(404);
    expect((await get(TENANT_A, ghost)).statusCode).toBe(404);
  });

  it('enforces duration plus buffer on the merged values against the stored item (AC-03.11)', async () => {
    const id = await create(TENANT_A, body('sum', { durationMinutes: 450 }));
    const res = await patch(TENANT_A, id, { bufferMinutes: 35 });
    expect(res.statusCode).toBe(400);
    expect((json(await get(TENANT_A, id))['bufferMinutes'] as number) === 0).toBe(true);
    expect((await patch(TENANT_A, id, { bufferMinutes: 30 })).statusCode).toBe(200);
  });

  it('never exposes a service to another tenant (AC-03.18)', async () => {
    const id = await create(TENANT_A, body('private'));
    expect((await get(TENANT_B, id)).statusCode).toBe(404);
    const attempt = await patch(TENANT_B, id, { active: false, priceMinor: 1 });
    expect(attempt.statusCode).toBe(404);
    expect(json(await get(TENANT_A, id))).toMatchObject({ active: true, priceMinor: 25050 });

    const ids = (json(await list(TENANT_B))['items'] as { id: string }[]).map((s) => s.id);
    expect(ids).not.toContain(id);

    // A page token from tenant B is refused for tenant A.
    const bToken = json(await list(TENANT_B, { limit: '1' }))['nextToken'] as string;
    expect(bToken).toBeTypeOf('string');
    const refused = await list(TENANT_A, { nextToken: bToken });
    expect(refused.statusCode).toBe(400);
    expect(json(refused)['code']).toBe('invalid_page_token');
  });
});
