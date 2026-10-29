import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { StaffLookupBusyError } from '../services/services.js';
import { DynamoStaffRepository } from './dynamo-staff-repository.js';
import { StaffMissingError, type StaffRecord } from './staff.js';

const TENANT = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const member = (n: number, active = true): StaffRecord => ({
  id: `0000000000000000000000${String(n).padStart(4, '0')}`,
  name: `M${String(n)}`,
  active,
  createdAt: '2026-10-23T10:00:00.000Z',
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
  return { repo: new DynamoStaffRepository(db, 'data-table'), sent };
}

describe('create and update', () => {
  it('writes the member under its tenant and refuses to overwrite', async () => {
    const { repo, sent } = repoWith([{}]);
    await repo.create(TENANT, member(1));
    expect((sent[0] as PutCommand).input).toMatchObject({
      TableName: 'data-table',
      Item: { PK: `T#${TENANT}`, SK: `STAFF#${member(1).id}`, entity: 'STAFF', name: 'M1' },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
  });

  it('sets only the given fields with aliased names and requires the item to exist', async () => {
    const { repo, sent } = repoWith([{ Attributes: { ...member(1) } }]);
    await repo.update(TENANT, member(1).id, { name: 'New', active: false });
    expect((sent[0] as UpdateCommand).input).toMatchObject({
      Key: { PK: `T#${TENANT}`, SK: `STAFF#${member(1).id}` },
      UpdateExpression: 'SET #name = :name, #active = :active',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#name': 'name', '#active': 'active' },
      ExpressionAttributeValues: { ':name': 'New', ':active': false },
      ReturnValues: 'ALL_NEW',
    });
  });

  it('maps a failed condition to "missing" and lets other errors through', async () => {
    const missing = repoWith([
      new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }),
    ]);
    await expect(missing.repo.update(TENANT, 'x', { active: false })).rejects.toBeInstanceOf(
      StaffMissingError,
    );
    const other = repoWith([new Error('boom')]);
    await expect(other.repo.update(TENANT, 'x', { active: false })).rejects.toThrow('boom');
  });
});

describe('list', () => {
  it('queries only the tenant’s STAFF# items', async () => {
    const { repo, sent } = repoWith([{ Items: [{ ...member(1) }] }]);
    const page = await repo.list(TENANT, { limit: 10, includeInactive: false });
    expect(page.items).toEqual([member(1)]);
    expect((sent[0] as { input: unknown }).input).toMatchObject({
      ExpressionAttributeValues: { ':pk': `T#${TENANT}`, ':prefix': 'STAFF#' },
      ConsistentRead: true,
    });
  });

  it('skips retired members and keeps reading until the page is full', async () => {
    const { repo } = repoWith([
      { Items: [{ ...member(1, false) }], LastEvaluatedKey: { SK: 'a' } },
      { Items: [{ ...member(2) }, { ...member(3) }] },
    ]);
    const page = await repo.list(TENANT, { limit: 2, includeInactive: false });
    expect(page.items.map((m) => m.name)).toEqual(['M2', 'M3']);
    expect(page.lastId).toBeUndefined();
  });
});

describe('existingIds (the staffIds check)', () => {
  it('reads the keys of this tenant in one batch and returns the ids found', async () => {
    const { repo, sent } = repoWith([
      { Responses: { 'data-table': [{ id: member(1).id }, { id: member(2).id }] } },
    ]);
    const found = await repo.existingIds(TENANT, [member(1).id, member(2).id, 'unknown']);
    expect(found).toEqual(new Set([member(1).id, member(2).id]));
    const input = (sent[0] as BatchGetCommand).input;
    expect(input.RequestItems?.['data-table']?.Keys).toEqual([
      { PK: `T#${TENANT}`, SK: `STAFF#${member(1).id}` },
      { PK: `T#${TENANT}`, SK: `STAFF#${member(2).id}` },
      { PK: `T#${TENANT}`, SK: 'STAFF#unknown' },
    ]);
  });

  it('asks only once for a repeated id', async () => {
    const { repo, sent } = repoWith([{ Responses: { 'data-table': [] } }]);
    await repo.existingIds(TENANT, ['a', 'a']);
    expect((sent[0] as BatchGetCommand).input.RequestItems?.['data-table']?.Keys).toHaveLength(1);
  });

  it('asks again for keys DynamoDB left unprocessed', async () => {
    const left = { PK: `T#${TENANT}`, SK: `STAFF#${member(2).id}` };
    const { repo, sent } = repoWith([
      {
        Responses: { 'data-table': [{ id: member(1).id }] },
        UnprocessedKeys: { 'data-table': { Keys: [left] } },
      },
      { Responses: { 'data-table': [{ id: member(2).id }] } },
    ]);
    const found = await repo.existingIds(TENANT, [member(1).id, member(2).id]);
    expect(found).toEqual(new Set([member(1).id, member(2).id]));
    expect((sent[1] as BatchGetCommand).input.RequestItems?.['data-table']?.Keys).toEqual([left]);
  });

  it('gives up when keys stay unprocessed', async () => {
    const left = { PK: 'p', SK: 's' };
    const stuck = { UnprocessedKeys: { 'data-table': { Keys: [left] } } };
    const { repo } = repoWith([stuck, stuck, stuck]);
    await expect(repo.existingIds(TENANT, ['a'])).rejects.toBeInstanceOf(StaffLookupBusyError);
  });
});
