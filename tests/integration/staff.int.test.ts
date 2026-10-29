// Runs the catalog handler against a real DynamoDB table (the deployed dev stack) for US-04: the
// staff endpoints, and the staffIds of services, which rely on a batched read, a DynamoDB string
// set and a REMOVE update that fakes cannot prove. Skipped unless SLOTWISE_DATA_TABLE is set.
//
//   AWS_PROFILE=slotwise SLOTWISE_DATA_TABLE=slotwise-dev-data npm test
//
// Each run uses two random tenant ids and deletes every item under them.
import { randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { apiEvent, ownerOf, staffOf } from '../helpers/api-event.js';
import { realCatalogApp } from '../helpers/real-catalog-app.js';

const tableName = process.env['SLOTWISE_DATA_TABLE'];

const TENANT_A = ulid();
const TENANT_B = ulid();

describe.skipIf(tableName === undefined)('staff against DynamoDB', () => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const table = tableName ?? '';
  const run = randomBytes(2).toString('hex');
  const app = realCatalogApp(db, table);

  type Res = { statusCode?: number | undefined; body?: string | undefined };
  const json = (r: Res) => JSON.parse(r.body ?? 'null') as Record<string, unknown>;
  const as = (tenantId: string, routeKey: string, extra: Record<string, unknown> = {}) =>
    app(apiEvent({ routeKey, caller: ownerOf(tenantId), ...extra }));

  const createStaff = async (tenantId: string, n: string) => {
    const res = await as(tenantId, 'POST /staff', { body: { name: `it-${run}-${n}` } });
    expect(res.statusCode).toBe(201);
    return json(res)['id'] as string;
  };
  const createService = (tenantId: string, n: string, staffIds?: string[]) =>
    as(tenantId, 'POST /services', {
      body: {
        name: `it-${run}-${n}`,
        durationMinutes: 30,
        priceMinor: 100,
        ...(staffIds && { staffIds }),
      },
    });
  const patchService = (tenantId: string, id: string, body: unknown) =>
    as(tenantId, 'PATCH /services/{serviceId}', { pathParameters: { serviceId: id }, body });
  const getService = (tenantId: string, id: string) =>
    as(tenantId, 'GET /services/{serviceId}', { pathParameters: { serviceId: id } });

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

  it('creates, reads, renames, retires and restores a member (AC-04.4 to AC-04.13)', async () => {
    const id = await createStaff(TENANT_A, 'basic');
    const got = await as(TENANT_A, 'GET /staff/{staffId}', { pathParameters: { staffId: id } });
    expect(json(got)).toMatchObject({ id, active: true });

    const patch = (body: unknown) =>
      as(TENANT_A, 'PATCH /staff/{staffId}', { pathParameters: { staffId: id }, body });
    expect(json(await patch({ name: `it-${run}-renamed` }))).toMatchObject({
      name: `it-${run}-renamed`,
      active: true,
    });
    expect(json(await patch({ active: false }))).toMatchObject({ active: false });
    expect(json(await patch({ active: true }))).toMatchObject({ active: true });

    const ghost = ulid();
    const missing = await as(TENANT_A, 'PATCH /staff/{staffId}', {
      pathParameters: { staffId: ghost },
      body: { active: false },
    });
    expect(missing.statusCode).toBe(404);
    const stillMissing = await as(TENANT_A, 'GET /staff/{staffId}', {
      pathParameters: { staffId: ghost },
    });
    expect(stillMissing.statusCode).toBe(404);
  });

  it('pages through staff and skips retired members (AC-04.7, AC-04.8)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await createStaff(TENANT_B, `page-${String(i)}`));
    await as(TENANT_B, 'PATCH /staff/{staffId}', {
      pathParameters: { staffId: ids[1] ?? '' },
      body: { active: false },
    });

    const seen: string[] = [];
    let nextToken: string | undefined;
    let pages = 0;
    do {
      const res = await as(TENANT_B, 'GET /staff', {
        query: { limit: '2', ...(nextToken && { nextToken }) },
      });
      expect(res.statusCode).toBe(200);
      seen.push(...(json(res)['items'] as { id: string }[]).map((s) => s.id));
      nextToken = json(res)['nextToken'] as string | undefined;
      pages++;
    } while (nextToken !== undefined);
    expect(seen).toEqual([ids[0], ids[2], ids[3], ids[4]]);
    expect(pages).toBe(2);

    const all = json(await as(TENANT_B, 'GET /staff', { query: { includeInactive: 'true' } }));
    expect((all['items'] as unknown[]).length).toBe(5);
  });

  it('writes, replaces, empties and keeps staffIds of a service (AC-04.14 to AC-04.17)', async () => {
    const one = await createStaff(TENANT_A, 'link-1');
    const two = await createStaff(TENANT_A, 'link-2');

    const created = await createService(TENANT_A, 'with-staff', [two, one]);
    expect(created.statusCode).toBe(201);
    const id = json(created)['id'] as string;
    expect(json(created)['staffIds']).toEqual([one, two].sort());
    expect(json(await getService(TENANT_A, id))['staffIds']).toEqual([one, two].sort());

    const replaced = await patchService(TENANT_A, id, { staffIds: [two] });
    expect(json(replaced)['staffIds']).toEqual([two]);
    // Left out: the set does not change.
    expect(json(await patchService(TENANT_A, id, { priceMinor: 5 }))['staffIds']).toEqual([two]);
    // Emptied together with another change in one update.
    const emptied = await patchService(TENANT_A, id, { name: `it-${run}-x`, staffIds: [] });
    expect(json(emptied)).toMatchObject({ staffIds: [], name: `it-${run}-x` });
    expect(json(await getService(TENANT_A, id))['staffIds']).toEqual([]);

    const without = await createService(TENANT_A, 'no-staff');
    expect(json(without)['staffIds']).toEqual([]);
  });

  it('reads a service stored before US-04 as having no staff (AC-04.17)', async () => {
    const id = ulid();
    await db.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `T#${TENANT_A}`,
          SK: `SVC#${id}`,
          entity: 'SERVICE',
          id,
          name: `it-${run}-old`,
          durationMinutes: 30,
          bufferMinutes: 0,
          priceMinor: 1,
          active: true,
          createdAt: new Date().toISOString(),
        },
      }),
    );
    expect(json(await getService(TENANT_A, id))['staffIds']).toEqual([]);
    const staff = await createStaff(TENANT_A, 'late');
    expect(json(await patchService(TENANT_A, id, { staffIds: [staff] }))['staffIds']).toEqual([
      staff,
    ]);
  });

  it('accepts a retired member and keeps the link when a member is retired (AC-04.15, AC-04.18)', async () => {
    const staff = await createStaff(TENANT_A, 'retire');
    await as(TENANT_A, 'PATCH /staff/{staffId}', {
      pathParameters: { staffId: staff },
      body: { active: false },
    });
    const res = await createService(TENANT_A, 'retired-link', [staff]);
    expect(res.statusCode).toBe(201);
    expect(json(res)['staffIds']).toEqual([staff]);
  });

  it('checks many ids in one batch and refuses one unknown id among them (AC-04.15)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await createStaff(TENANT_A, `many-${String(i)}`));
    expect((await createService(TENANT_A, 'many', ids)).statusCode).toBe(201);
    const refused = await createService(TENANT_A, 'many-bad', [...ids, ulid()]);
    expect(refused.statusCode).toBe(400);
    expect(json(refused)['details']).toEqual([{ field: 'staffIds', issue: 'unknown_staff' }]);
  });

  it('never exposes staff to another tenant, nor lets it attach them (AC-04.21)', async () => {
    const id = await createStaff(TENANT_A, 'private');
    const asB = (routeKey: string, extra: Record<string, unknown>) =>
      as(TENANT_B, routeKey, { pathParameters: { staffId: id }, ...extra });
    expect((await asB('GET /staff/{staffId}', {})).statusCode).toBe(404);
    expect((await asB('PATCH /staff/{staffId}', { body: { active: false } })).statusCode).toBe(404);
    const mine = await as(TENANT_A, 'GET /staff/{staffId}', { pathParameters: { staffId: id } });
    expect(json(mine)).toMatchObject({ active: true });

    const list = json(await as(TENANT_B, 'GET /staff'));
    expect((list['items'] as { id: string }[]).map((s) => s.id)).not.toContain(id);

    const attach = await createService(TENANT_B, 'steal', [id]);
    expect(attach.statusCode).toBe(400);
    expect(json(attach)['details']).toEqual([{ field: 'staffIds', issue: 'unknown_staff' }]);

    const bToken = json(await as(TENANT_B, 'GET /staff', { query: { limit: '1' } }))['nextToken'];
    expect(bToken).toBeTypeOf('string');
    const refused = await as(TENANT_A, 'GET /staff', { query: { nextToken: bToken as string } });
    expect(json(refused)['code']).toBe('invalid_page_token');
  });

  it('lets staff read but not write', async () => {
    const id = await createStaff(TENANT_A, 'roles');
    const caller = staffOf(TENANT_A);
    const read = await app(
      apiEvent({ routeKey: 'GET /staff/{staffId}', caller, pathParameters: { staffId: id } }),
    );
    expect(read.statusCode).toBe(200);
    const write = await app(
      apiEvent({
        routeKey: 'PATCH /staff/{staffId}',
        caller,
        pathParameters: { staffId: id },
        body: { active: false },
      }),
    );
    expect(write.statusCode).toBe(403);
  });
});
