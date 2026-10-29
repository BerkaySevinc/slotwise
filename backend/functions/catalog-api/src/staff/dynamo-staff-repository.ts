import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { STAFF_SK_PREFIX, staffKey } from '@slotwise/shared';
import { listByPrefix, type ListOptions } from '../http/dynamo-list.js';
import { StaffLookupBusyError } from '../services/services.js';
import {
  StaffMissingError,
  type StaffChanges,
  type StaffRecord,
  type StaffRepository,
} from './staff.js';

const MAX_BATCH_ATTEMPTS = 3;

function toRecord(item: Record<string, unknown>): StaffRecord {
  return {
    id: item['id'] as string,
    name: item['name'] as string,
    active: item['active'] as boolean,
    createdAt: item['createdAt'] as string,
  };
}

export class DynamoStaffRepository implements StaffRepository {
  constructor(
    private readonly db: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly tableName: string,
  ) {}

  async create(tenantId: string, member: StaffRecord): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...staffKey(tenantId, member.id), entity: 'STAFF', ...member },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async get(tenantId: string, staffId: string): Promise<StaffRecord | undefined> {
    const out = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: staffKey(tenantId, staffId),
        ConsistentRead: true,
      }),
    );
    return out.Item === undefined ? undefined : toRecord(out.Item);
  }

  list(tenantId: string, options: ListOptions): Promise<{ items: StaffRecord[]; lastId?: string }> {
    return listByPrefix(
      this.db,
      this.tableName,
      tenantId,
      STAFF_SK_PREFIX,
      (id) => staffKey(tenantId, id),
      toRecord,
      options,
    );
  }

  async update(tenantId: string, staffId: string, changes: StaffChanges): Promise<StaffRecord> {
    // `name` is a DynamoDB reserved word, so every attribute is aliased.
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    for (const [field, value] of Object.entries(changes)) {
      names[`#${field}`] = field;
      values[`:${field}`] = value;
      sets.push(`#${field} = :${field}`);
    }
    try {
      const out = await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: staffKey(tenantId, staffId),
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return toRecord(out.Attributes ?? {});
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new StaffMissingError();
      throw e;
    }
  }

  /** Which of these ids are staff members of this tenant, active or not (one batched read). */
  async existingIds(tenantId: string, staffIds: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    let keys: Record<string, unknown>[] = [...new Set(staffIds)].map((id) => ({
      ...staffKey(tenantId, id),
    }));
    // BatchGetItem may return some keys unprocessed under load; ask again for those.
    for (let attempt = 0; keys.length > 0; attempt++) {
      if (attempt >= MAX_BATCH_ATTEMPTS) {
        throw new StaffLookupBusyError('BatchGetItem left keys unprocessed');
      }
      const out = await this.db.send(
        new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: keys,
              ProjectionExpression: '#id',
              ExpressionAttributeNames: { '#id': 'id' },
              ConsistentRead: true,
            },
          },
        }),
      );
      for (const item of out.Responses?.[this.tableName] ?? []) found.add(item['id'] as string);
      keys = out.UnprocessedKeys?.[this.tableName]?.Keys ?? [];
    }
    return found;
  }
}
