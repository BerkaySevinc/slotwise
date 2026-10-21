import { TransactionCanceledException, type CancellationReason } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  DEFAULT_TENANT_SETTINGS,
  ownerKey,
  slugKey,
  tenantProfileKey,
  tenantSettingsKey,
} from '@slotwise/shared';
import {
  NotProvisioningError,
  OwnerExistsError,
  SlugTakenError,
  TransactionConflictError,
  type TenantRecord,
  type TenantRepository,
  type TenantStatus,
} from './create-tenant.js';

const MAX_CONFLICT_RETRIES = 4;
const RETRYABLE_CODES = new Set([
  'TransactionConflict',
  'ThrottlingError',
  'ProvisionedThroughputExceeded',
]);

const NOT_EXISTS = 'attribute_not_exists(PK)';
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class DynamoTenantRepository implements TenantRepository {
  constructor(
    private readonly db: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly tableName: string,
    private readonly sleep: (ms: number) => Promise<void> = wait,
  ) {}

  async findOwnerTenantId(userId: string): Promise<string | undefined> {
    const out = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: ownerKey(userId), ConsistentRead: true }),
    );
    return out.Item?.['tenantId'] as string | undefined;
  }

  async getTenant(tenantId: string): Promise<TenantRecord | undefined> {
    const out = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: tenantProfileKey(tenantId),
        ConsistentRead: true,
      }),
    );
    const item = out.Item;
    if (item === undefined) return undefined;
    return {
      id: item['id'] as string,
      name: item['name'] as string,
      slug: item['slug'] as string,
      timeZone: item['timeZone'] as string,
      status: item['status'] as TenantStatus,
      ownerId: item['ownerId'] as string,
      createdAt: item['createdAt'] as string,
    };
  }

  async createProvisioning(tenant: TenantRecord): Promise<void> {
    const put = (Item: Record<string, unknown>) => ({
      Put: { TableName: this.tableName, Item, ConditionExpression: NOT_EXISTS },
    });
    // Item order matters: classifyCreate reads the cancellation reasons by index.
    await this.transact(
      {
        TransactItems: [
          put({ ...tenantProfileKey(tenant.id), entity: 'TENANT', ...tenant }),
          put({
            ...tenantSettingsKey(tenant.id),
            entity: 'TENANT_SETTINGS',
            ...DEFAULT_TENANT_SETTINGS,
          }),
          put({ ...slugKey(tenant.slug), entity: 'SLUG', tenantId: tenant.id }),
          put({ ...ownerKey(tenant.ownerId), entity: 'OWNER', tenantId: tenant.id }),
        ],
      },
      classifyCreate,
    );
  }

  async updateProvisioning(
    tenant: TenantRecord,
    changes: { name: string; slug: string; timeZone: string },
  ): Promise<void> {
    const update = {
      Update: {
        TableName: this.tableName,
        Key: tenantProfileKey(tenant.id),
        UpdateExpression: 'SET #name = :name, slug = :slug, timeZone = :tz',
        ConditionExpression: '#status = :provisioning',
        ExpressionAttributeNames: { '#name': 'name', '#status': 'status' },
        ExpressionAttributeValues: {
          ':name': changes.name,
          ':slug': changes.slug,
          ':tz': changes.timeZone,
          ':provisioning': 'provisioning',
        },
      },
    };
    const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [update];
    if (changes.slug !== tenant.slug) {
      items.push(
        {
          Put: {
            TableName: this.tableName,
            Item: { ...slugKey(changes.slug), entity: 'SLUG', tenantId: tenant.id },
            ConditionExpression: NOT_EXISTS,
          },
        },
        {
          Delete: {
            TableName: this.tableName,
            Key: slugKey(tenant.slug),
            ConditionExpression: 'tenantId = :id',
            ExpressionAttributeValues: { ':id': tenant.id },
          },
        },
      );
    }
    await this.transact({ TransactItems: items }, classifyUpdate);
  }

  async activate(tenantId: string): Promise<void> {
    await this.db.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: tenantProfileKey(tenantId),
        UpdateExpression: 'SET #status = :active',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':active': 'active' },
      }),
    );
  }

  private async transact(
    input: TransactWriteCommandInput,
    classify: (reasons: CancellationReason[]) => Error | undefined,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.send(new TransactWriteCommand(input));
        return;
      } catch (e) {
        if (!(e instanceof TransactionCanceledException)) throw e;
        const reasons = e.CancellationReasons ?? [];
        const retryable = reasons.some((r) => r.Code !== undefined && RETRYABLE_CODES.has(r.Code));
        if (!retryable) throw classify(reasons) ?? e;
        if (attempt >= MAX_CONFLICT_RETRIES) throw new TransactionConflictError();
        await this.sleep(25 * 2 ** attempt + Math.random() * 25);
      }
    }
  }
}

const failed = (r: CancellationReason | undefined): boolean => r?.Code === 'ConditionalCheckFailed';

// Reasons follow the item order in createProvisioning: profile, settings, slug, owner.
function classifyCreate(reasons: CancellationReason[]): Error | undefined {
  if (failed(reasons[3])) return new OwnerExistsError();
  if (failed(reasons[2])) return new SlugTakenError();
  return undefined;
}

// Reasons follow the item order in updateProvisioning: profile, new slug, old slug.
function classifyUpdate(reasons: CancellationReason[]): Error | undefined {
  if (failed(reasons[1])) return new SlugTakenError();
  if (failed(reasons[0])) return new NotProvisioningError();
  return undefined;
}
