import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { DynamoServiceRepository } from './dynamo-service-repository.js';
import { ServiceMissingError, StaleServiceError, type ServiceRecord } from './services.js';

const TENANT = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const record = (n: number, active = true): ServiceRecord => ({
  id: `0000000000000000000000${String(n).padStart(4, '0')}`,
  name: `S${String(n)}`,
  durationMinutes: 30,
  bufferMinutes: 0,
  priceMinor: 100,
  active,
  staffIds: [],
  createdAt: '2026-10-23T10:00:00.000Z',
});
/** What DynamoDB returns: the staff ids are a set, left out when empty. */
const item = ({ staffIds, ...s }: ServiceRecord) => ({
  PK: `T#${TENANT}`,
  SK: `SVC#${s.id}`,
  entity: 'SERVICE',
  ...s,
  ...(staffIds.length > 0 && { staffIds: new Set(staffIds) }),
});

/** Answers each command from a queue and keeps what was sent. */
function repoWith(responses: (Record<string, unknown> | Error)[]) {
  const sent: unknown[] = [];
  const queue = [...responses];
  const db = {
    send: (command: unknown) => {
      sent.push(command);
      const next = queue.shift() ?? {};
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  } as unknown as DynamoDBDocumentClient;
  return { repo: new DynamoServiceRepository(db, 'data-table'), sent };
}

const checkFailed = (old?: Record<string, unknown>) =>
  new ConditionalCheckFailedException({
    message: 'failed',
    $metadata: {},
    ...(old && { Item: old as never }),
  });

describe('create', () => {
  it('writes the service under its tenant and refuses to overwrite', async () => {
    const { repo, sent } = repoWith([{}]);
    await repo.create(TENANT, record(1));
    const command = sent[0] as PutCommand;
    expect(command.input).toMatchObject({
      TableName: 'data-table',
      Item: { PK: `T#${TENANT}`, SK: `SVC#${record(1).id}`, entity: 'SERVICE', name: 'S1' },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
  });
});

describe('staff ids', () => {
  it('writes them as a set, and leaves the attribute out when there are none', async () => {
    const withStaff = repoWith([{}]);
    await withStaff.repo.create(TENANT, { ...record(1), staffIds: ['B', 'A'] });
    expect((withStaff.sent[0] as PutCommand).input.Item?.['staffIds']).toEqual(new Set(['A', 'B']));

    const without = repoWith([{}]);
    await without.repo.create(TENANT, record(1));
    expect(without.sent[0] as PutCommand).toBeDefined();
    expect((without.sent[0] as PutCommand).input.Item).not.toHaveProperty('staffIds');
  });

  it('reads the set as a sorted array, and a missing attribute as none', async () => {
    const { repo } = repoWith([
      { Item: { ...item(record(1)), staffIds: new Set(['B', 'A']) } },
      { Item: item(record(2)) },
    ]);
    expect((await repo.get(TENANT, record(1).id))?.staffIds).toEqual(['A', 'B']);
    expect((await repo.get(TENANT, record(2).id))?.staffIds).toEqual([]);
  });

  it('replaces the set in an update', async () => {
    const { repo, sent } = repoWith([{ Attributes: item(record(1)) }]);
    await repo.update(TENANT, record(1).id, { staffIds: ['A', 'B'] });
    expect((sent[0] as UpdateCommand).input).toMatchObject({
      UpdateExpression: 'SET #staffIds = :staffIds',
      ExpressionAttributeValues: { ':staffIds': new Set(['A', 'B']) },
    });
  });

  it('removes the attribute to empty the set, without an empty value map', async () => {
    const { repo, sent } = repoWith([{ Attributes: item(record(1)) }]);
    await repo.update(TENANT, record(1).id, { staffIds: [] });
    const input = (sent[0] as UpdateCommand).input;
    expect(input.UpdateExpression).toBe('REMOVE #staffIds');
    expect(input.ExpressionAttributeValues).toBeUndefined();
  });

  it('can set other fields and empty the set in one update', async () => {
    const { repo, sent } = repoWith([{ Attributes: item(record(1)) }]);
    await repo.update(TENANT, record(1).id, { name: 'New', staffIds: [] });
    expect((sent[0] as UpdateCommand).input.UpdateExpression).toBe(
      'SET #name = :name REMOVE #staffIds',
    );
  });
});

describe('list', () => {
  it('queries only the tenant’s SVC# items, with a consistent read', async () => {
    const { repo, sent } = repoWith([{ Items: [item(record(1))] }]);
    await repo.list(TENANT, { limit: 10, includeInactive: false });
    expect((sent[0] as QueryCommand).input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `T#${TENANT}`, ':prefix': 'SVC#' },
      ConsistentRead: true,
    });
  });

  it('starts after the given id', async () => {
    const { repo, sent } = repoWith([{ Items: [] }]);
    await repo.list(TENANT, { limit: 10, includeInactive: false, startAfterId: record(3).id });
    expect((sent[0] as QueryCommand).input.ExclusiveStartKey).toEqual({
      PK: `T#${TENANT}`,
      SK: `SVC#${record(3).id}`,
    });
  });

  it('keeps reading until it has `limit` active services', async () => {
    const { repo, sent } = repoWith([
      { Items: [item(record(1, false)), item(record(2, false))], LastEvaluatedKey: { SK: 'a' } },
      { Items: [item(record(3)), item(record(4, false))], LastEvaluatedKey: { SK: 'b' } },
      { Items: [item(record(5)), item(record(6))] },
    ]);
    const page = await repo.list(TENANT, { limit: 2, includeInactive: false });
    expect(page.items.map((s) => s.name)).toEqual(['S3', 'S5']);
    // S6 exists after the page, so there is a next page that starts after S5.
    expect(page.lastId).toBe(record(5).id);
    expect(sent).toHaveLength(3);
  });

  it('reads one item more than the limit to know whether a next page exists', async () => {
    const { repo, sent } = repoWith([{ Items: [item(record(1))] }]);
    await repo.list(TENANT, { limit: 10, includeInactive: false });
    expect((sent[0] as QueryCommand).input.Limit).toBe(11);
  });

  it('reports no next page when the last service fills the page and nothing follows', async () => {
    const { repo } = repoWith([{ Items: [item(record(1)), item(record(2))] }]);
    expect(await repo.list(TENANT, { limit: 2, includeInactive: false })).toEqual({
      items: [record(1), record(2)],
    });
  });

  it('gives no token to an empty page even when DynamoDB still returns a LastEvaluatedKey', async () => {
    const { repo } = repoWith([
      { Items: [item(record(1)), item(record(2))], LastEvaluatedKey: { SK: 'a' } },
      { Items: [] },
    ]);
    const page = await repo.list(TENANT, { limit: 2, includeInactive: false });
    expect(page).toEqual({ items: [record(1), record(2)] });
  });

  it('reports a next page only when a further service really exists', async () => {
    const { repo } = repoWith([{ Items: [item(record(1)), item(record(2))] }]);
    const page = await repo.list(TENANT, { limit: 1, includeInactive: true });
    expect(page.items).toEqual([record(1)]);
    expect(page.lastId).toBe(record(1).id);
  });

  it('does not count a retired service as a further one', async () => {
    const { repo } = repoWith([{ Items: [item(record(1)), item(record(2, false))] }]);
    const page = await repo.list(TENANT, { limit: 1, includeInactive: false });
    expect(page).toEqual({ items: [record(1)] });
  });

  it('returns retired services when asked', async () => {
    const { repo } = repoWith([{ Items: [item(record(1, false))] }]);
    const page = await repo.list(TENANT, { limit: 5, includeInactive: true });
    expect(page.items.map((s) => s.active)).toEqual([false]);
  });
});

describe('update', () => {
  it('sets only the given fields with aliased names and requires the item to exist', async () => {
    const { repo, sent } = repoWith([{ Attributes: item(record(1)) }]);
    await repo.update(TENANT, record(1).id, { name: 'New', priceMinor: 5 });
    expect((sent[0] as UpdateCommand).input).toMatchObject({
      Key: { PK: `T#${TENANT}`, SK: `SVC#${record(1).id}` },
      UpdateExpression: 'SET #name = :name, #priceMinor = :priceMinor',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#name': 'name', '#priceMinor': 'priceMinor' },
      ExpressionAttributeValues: { ':name': 'New', ':priceMinor': 5 },
      ReturnValues: 'ALL_NEW',
    });
  });

  it('guards on the duration and buffer that were read', async () => {
    const { repo, sent } = repoWith([{ Attributes: item(record(1)) }]);
    await repo.update(
      TENANT,
      record(1).id,
      { bufferMinutes: 10 },
      { durationMinutes: 30, bufferMinutes: 0 },
    );
    expect((sent[0] as UpdateCommand).input).toMatchObject({
      ConditionExpression:
        'attribute_exists(PK) AND #durationMinutes = :guardDuration AND #bufferMinutes = :guardBuffer',
      ExpressionAttributeValues: { ':bufferMinutes': 10, ':guardDuration': 30, ':guardBuffer': 0 },
    });
  });

  it('maps a failed condition with no item to "missing" and with an item to "stale"', async () => {
    const missing = repoWith([checkFailed()]);
    await expect(missing.repo.update(TENANT, 'x', { active: false })).rejects.toBeInstanceOf(
      ServiceMissingError,
    );
    const stale = repoWith([checkFailed(item(record(1)))]);
    await expect(stale.repo.update(TENANT, 'x', { active: false })).rejects.toBeInstanceOf(
      StaleServiceError,
    );
  });

  it('lets other errors through', async () => {
    const { repo } = repoWith([new Error('boom')]);
    await expect(repo.update(TENANT, 'x', { active: false })).rejects.toThrow('boom');
  });
});
