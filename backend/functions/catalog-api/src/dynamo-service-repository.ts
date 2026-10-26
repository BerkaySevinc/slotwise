import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { SERVICE_SK_PREFIX, serviceKey } from '@slotwise/shared';
import {
  ServiceMissingError,
  StaleServiceError,
  type ServiceChanges,
  type ServiceRecord,
  type ServiceRepository,
} from './services.js';

function toRecord(item: Record<string, unknown>): ServiceRecord {
  return {
    id: item['id'] as string,
    name: item['name'] as string,
    durationMinutes: item['durationMinutes'] as number,
    bufferMinutes: item['bufferMinutes'] as number,
    priceMinor: item['priceMinor'] as number,
    active: item['active'] as boolean,
    createdAt: item['createdAt'] as string,
  };
}

export class DynamoServiceRepository implements ServiceRepository {
  constructor(
    private readonly db: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly tableName: string,
  ) {}

  async create(tenantId: string, service: ServiceRecord): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...serviceKey(tenantId, service.id), entity: 'SERVICE', ...service },
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

  async list(
    tenantId: string,
    options: { limit: number; includeInactive: boolean; startAfterId?: string },
  ): Promise<{ items: ServiceRecord[]; lastId?: string }> {
    const items: ServiceRecord[] = [];
    let startKey: Record<string, unknown> | undefined =
      options.startAfterId === undefined
        ? undefined
        : { ...serviceKey(tenantId, options.startAfterId) };

    // Retired services are filtered here, not by DynamoDB, so `limit` counts returned services.
    // The loop is bounded by the number of services of one tenant, which is small by design.
    for (;;) {
      const out = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `T#${tenantId}`, ':prefix': SERVICE_SK_PREFIX },
          ExclusiveStartKey: startKey,
          Limit: options.limit,
          ConsistentRead: true,
        }),
      );
      const page = out.Items ?? [];
      for (const [index, item] of page.entries()) {
        const record = toRecord(item);
        if (!options.includeInactive && !record.active) continue;
        items.push(record);
        if (items.length === options.limit) {
          const more = index < page.length - 1 || out.LastEvaluatedKey !== undefined;
          return more ? { items, lastId: record.id } : { items };
        }
      }
      if (out.LastEvaluatedKey === undefined) return { items };
      startKey = out.LastEvaluatedKey;
    }
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
    for (const [field, value] of Object.entries(changes)) {
      names[`#${field}`] = field;
      values[`:${field}`] = value;
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

    try {
      const out = await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: serviceKey(tenantId, serviceId),
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
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
