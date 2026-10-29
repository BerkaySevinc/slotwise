import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { SERVICE_SK_PREFIX, serviceKey } from '@slotwise/shared';
import { listByPrefix, type ListOptions } from '../http/dynamo-list.js';
import {
  ServiceMissingError,
  StaleServiceError,
  type ServiceChanges,
  type ServiceRecord,
  type ServiceRepository,
} from './services.js';

function toRecord(item: Record<string, unknown>): ServiceRecord {
  // DynamoDB keeps the staff ids as a string set, which cannot be empty: no attribute means none.
  const staffIds = item['staffIds'] as Set<string> | undefined;
  return {
    id: item['id'] as string,
    name: item['name'] as string,
    durationMinutes: item['durationMinutes'] as number,
    bufferMinutes: item['bufferMinutes'] as number,
    priceMinor: item['priceMinor'] as number,
    active: item['active'] as boolean,
    staffIds: [...(staffIds ?? [])].sort(),
    createdAt: item['createdAt'] as string,
  };
}

export class DynamoServiceRepository implements ServiceRepository {
  constructor(
    private readonly db: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly tableName: string,
  ) {}

  async create(tenantId: string, service: ServiceRecord): Promise<void> {
    const { staffIds, ...rest } = service;
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...serviceKey(tenantId, service.id),
          entity: 'SERVICE',
          ...rest,
          ...(staffIds.length > 0 && { staffIds: new Set(staffIds) }),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async get(tenantId: string, serviceId: string): Promise<ServiceRecord | undefined> {
    const out = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: serviceKey(tenantId, serviceId),
        ConsistentRead: true,
      }),
    );
    return out.Item === undefined ? undefined : toRecord(out.Item);
  }

  list(
    tenantId: string,
    options: ListOptions,
  ): Promise<{ items: ServiceRecord[]; lastId?: string }> {
    return listByPrefix(
      this.db,
      this.tableName,
      tenantId,
      SERVICE_SK_PREFIX,
      (id) => serviceKey(tenantId, id),
      toRecord,
      options,
    );
  }

  async update(
    tenantId: string,
    serviceId: string,
    changes: ServiceChanges,
    guard?: { durationMinutes: number; bufferMinutes: number },
  ): Promise<ServiceRecord> {
    // Every attribute is aliased: `name` is a DynamoDB reserved word.
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    const removes: string[] = [];
    for (const [field, value] of Object.entries(changes)) {
      names[`#${field}`] = field;
      if (field === 'staffIds' && (value as string[]).length === 0) {
        removes.push(`#${field}`);
        continue;
      }
      values[`:${field}`] = field === 'staffIds' ? new Set(value as string[]) : value;
      sets.push(`#${field} = :${field}`);
    }

    let condition = 'attribute_exists(PK)';
    if (guard !== undefined) {
      names['#durationMinutes'] = 'durationMinutes';
      names['#bufferMinutes'] = 'bufferMinutes';
      values[':guardDuration'] = guard.durationMinutes;
      values[':guardBuffer'] = guard.bufferMinutes;
      condition += ' AND #durationMinutes = :guardDuration AND #bufferMinutes = :guardBuffer';
    }

    const expression = [
      sets.length > 0 ? `SET ${sets.join(', ')}` : '',
      removes.length > 0 ? `REMOVE ${removes.join(', ')}` : '',
    ]
      .filter((part) => part !== '')
      .join(' ');

    try {
      const out = await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: serviceKey(tenantId, serviceId),
          UpdateExpression: expression,
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          // DynamoDB rejects an empty map.
          ...(Object.keys(values).length > 0 && { ExpressionAttributeValues: values }),
          ReturnValues: 'ALL_NEW',
          // Lets the repository tell "missing" from "stale" without a second read when it can.
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }),
      );
      return toRecord(out.Attributes ?? {});
    } catch (e) {
      if (!(e instanceof ConditionalCheckFailedException)) throw e;
      throw e.Item === undefined ? new ServiceMissingError() : new StaleServiceError();
    }
  }
}
