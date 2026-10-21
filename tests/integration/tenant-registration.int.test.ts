// Runs against a real DynamoDB table (the deployed dev stack), because transaction atomicity and
// conflict handling cannot be proven with fakes. Skipped unless SLOTWISE_DATA_TABLE is set.
//
//   AWS_PROFILE=slotwise SLOTWISE_DATA_TABLE=slotwise-dev-data npm test
//
// Each run uses random slugs and user ids and deletes what it created. Cognito is not involved:
// it is replaced by a fake directory, so this does not cover the Cognito permission or call.
import { randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ownerKey, slugKey, tenantProfileKey, tenantSettingsKey } from '@slotwise/shared';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createTenant,
  type CreateTenantDeps,
} from '../../backend/functions/tenant-api/src/create-tenant.js';
import { DynamoTenantRepository } from '../../backend/functions/tenant-api/src/dynamo-tenant-repository.js';
import { ulid } from 'ulid';

const tableName = process.env['SLOTWISE_DATA_TABLE'];

describe.skipIf(tableName === undefined)('tenant registration against DynamoDB', () => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const table = tableName ?? '';
  const run = randomBytes(4).toString('hex');
  const createdTenants: { id: string; slug: string; ownerId: string }[] = [];
  let cognitoFails = false;

  const deps = (): CreateTenantDeps => ({
    repository: new DynamoTenantRepository(db, table),
    directory: {
      setOwnerClaims: () =>
        cognitoFails ? Promise.reject(new Error('simulated')) : Promise.resolve(),
    },
    newId: () => {
      const id = ulid();
      return id;
    },
    now: () => new Date(),
    logger: { info: () => undefined, error: () => undefined },
    onProvisioningIncomplete: () => undefined,
  });

  const input = (slug: string) => ({ name: 'Test Shop', slug, timeZone: 'Europe/Istanbul' });
  const user = (n: string) => `it-${run}-${n}`;
  const slug = (n: string) => `it-${run}-${n}`;

  async function register(userId: string, s: string) {
    try {
      const t = await createTenant(deps(), userId, input(s));
      createdTenants.push({ id: t.id, slug: s, ownerId: userId });
      return { ok: true as const, tenant: t };
    } catch (e) {
      return { ok: false as const, code: (e as { code?: string }).code };
    }
  }

  const exists = async (key: { PK: string; SK: string }) =>
    (await db.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item;

  afterAll(async () => {
    const keys = createdTenants.flatMap((t) => [
      tenantProfileKey(t.id),
      tenantSettingsKey(t.id),
      slugKey(t.slug),
      ownerKey(t.ownerId),
    ]);
    for (let i = 0; i < keys.length; i += 25) {
      await db.send(
        new BatchWriteCommand({
          RequestItems: {
            [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
          },
        }),
      );
    }
  });

  it('commits profile, settings, slug and owner items together (AC-01.8)', async () => {
    const r = await register(user('a'), slug('a'));
    expect(r.ok && r.tenant.status).toBe('active');
    if (!r.ok) return;
    expect(await exists(tenantProfileKey(r.tenant.id))).toMatchObject({ status: 'active' });
    expect(await exists(tenantSettingsKey(r.tenant.id))).toMatchObject({
      slotGranularityMinutes: 15,
    });
    expect(await exists(slugKey(slug('a')))).toMatchObject({ tenantId: r.tenant.id });
    expect(await exists(ownerKey(user('a')))).toMatchObject({ tenantId: r.tenant.id });
  });

  it('rejects a taken slug and writes nothing for the loser (AC-01.11)', async () => {
    await register(user('b1'), slug('b'));
    const r = await register(user('b2'), slug('b'));
    expect(r).toEqual({ ok: false, code: 'slug_taken' });
    expect(await exists(ownerKey(user('b2')))).toBeUndefined();
  });

  it('rejects a second tenant for the same user (AC-01.14)', async () => {
    await register(user('c'), slug('c1'));
    expect(await register(user('c'), slug('c2'))).toEqual({
      ok: false,
      code: 'tenant_already_exists',
    });
    expect(await exists(slugKey(slug('c2')))).toBeUndefined();
  });

  it('completes a provisioning tenant on a repeated call and may change the slug (AC-01.16, 01.17)', async () => {
    cognitoFails = true;
    expect(await register(user('d'), slug('d1'))).toEqual({
      ok: false,
      code: 'provisioning_incomplete',
    });
    cognitoFails = false;
    const ownerItem = await exists(ownerKey(user('d')));
    const tenantId = ownerItem?.['tenantId'] as string;
    createdTenants.push({ id: tenantId, slug: slug('d1'), ownerId: user('d') });
    expect(await exists(tenantProfileKey(tenantId))).toMatchObject({ status: 'provisioning' });

    const r = await register(user('d'), slug('d2'));
    expect(r.ok && r.tenant.id).toBe(tenantId);
    expect(await exists(slugKey(slug('d1')))).toBeUndefined();
    expect(await exists(slugKey(slug('d2')))).toMatchObject({ tenantId });
    expect(await exists(tenantProfileKey(tenantId))).toMatchObject({
      status: 'active',
      slug: slug('d2'),
    });
  });

  it('50 parallel requests from 50 users for one slug give exactly one success (AC-01.12)', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => register(user(`p${String(i)}`), slug('race'))),
    );
    const outcomes = results.map((r) => (r.ok ? 'created' : r.code));
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'slug_taken')).toHaveLength(49);
  }, 60_000);
});
