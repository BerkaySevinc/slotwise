import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ItemKey } from '@slotwise/shared';

export interface ListOptions {
  limit: number;
  includeInactive: boolean;
  startAfterId?: string;
}

/**
 * One page of the items of one tenant that share a sort key prefix (`SVC#`, `STAFF#`), in id order.
 *
 * Retired items are filtered here, not by DynamoDB, so `limit` counts returned items. The loop is
 * bounded by the number of such items of one tenant, which is small by design.
 *
 * `lastId` is set only when a further item really exists. It reads one item more than `limit`
 * instead of trusting `LastEvaluatedKey`: DynamoDB may return that key when the limit is reached
 * exactly at the end of the data, which would hand out a token to an empty page.
 */
export async function listByPrefix<T extends { id: string; active: boolean }>(
  db: Pick<DynamoDBDocumentClient, 'send'>,
  tableName: string,
  tenantId: string,
  prefix: string,
  keyOf: (id: string) => ItemKey,
  toRecord: (item: Record<string, unknown>) => T,
  options: ListOptions,
): Promise<{ items: T[]; lastId?: string }> {
  const wanted = options.limit + 1;
  const matches: T[] = [];
  let startKey: Record<string, unknown> | undefined =
    options.startAfterId === undefined ? undefined : { ...keyOf(options.startAfterId) };

  collect: for (;;) {
    const out = await db.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `T#${tenantId}`, ':prefix': prefix },
        ExclusiveStartKey: startKey,
        Limit: wanted,
        ConsistentRead: true,
      }),
    );
    for (const item of out.Items ?? []) {
      const record = toRecord(item);
      if (!options.includeInactive && !record.active) continue;
      matches.push(record);
      if (matches.length === wanted) break collect;
    }
    if (out.LastEvaluatedKey === undefined) break;
    startKey = out.LastEvaluatedKey;
  }

  const items = matches.slice(0, options.limit);
  const last = items.at(-1);
  return matches.length > options.limit && last !== undefined
    ? { items, lastId: last.id }
    : { items };
}
