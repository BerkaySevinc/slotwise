import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import {
  NotProvisioningError,
  OwnerExistsError,
  SlugTakenError,
  TransactionConflictError,
  type TenantRecord,
} from './create-tenant.js';
import { DynamoTenantRepository } from './dynamo-tenant-repository.js';

const tenant: TenantRecord = {
  id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  name: 'Ahmet Berber',
  slug: 'ahmet-berber',
  timeZone: 'Europe/Istanbul',
  status: 'provisioning',
  ownerId: 'user-1',
  createdAt: '2026-10-21T10:00:00.000Z',
};

const cancelled = (...codes: string[]): TransactionCanceledException =>
  new TransactionCanceledException({
    message: 'cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

function repoWith(responses: (Error | undefined)[]) {
  const sent: unknown[] = [];
  const queue = [...responses];
  const db = {
    send: (command: unknown) => {
      sent.push(command);
      const next = queue.shift();
      return next ? Promise.reject(next) : Promise.resolve({});
    },
  } as unknown as DynamoDBDocumentClient;
  return { repo: new DynamoTenantRepository(db, 'data-table', () => Promise.resolve()), sent };
}

describe('createProvisioning', () => {
  it('writes profile, settings, slug and owner items in one guarded transaction', async () => {
    const { repo, sent } = repoWith([]);
    await repo.createProvisioning(tenant);

    expect(sent).toHaveLength(1);
    const command = sent[0] as TransactWriteCommand;
    const items = command.input.TransactItems ?? [];
    expect(items.map((i): unknown => i.Put?.Item?.['PK'])).toEqual([
      `T#${tenant.id}`,
      `T#${tenant.id}`,
      'SLUG#ahmet-berber',
      'OWNER#user-1',
    ]);
    expect(items.map((i): unknown => i.Put?.Item?.['SK'])).toEqual([
      'PROFILE',
      'SETTINGS',
      'SLUG',
      'OWNER',
    ]);
    expect(items.every((i) => i.Put?.ConditionExpression === 'attribute_not_exists(PK)')).toBe(
      true,
    );
    expect(items[0]?.Put?.Item).toMatchObject({ status: 'provisioning', ownerId: 'user-1' });
    expect(items[1]?.Put?.Item).toMatchObject({ slotGranularityMinutes: 15 });
  });

  it('maps a failed slug condition to SlugTakenError', async () => {
    const { repo } = repoWith([cancelled('None', 'None', 'ConditionalCheckFailed', 'None')]);
    await expect(repo.createProvisioning(tenant)).rejects.toBeInstanceOf(SlugTakenError);
  });

  it('maps a failed owner condition to OwnerExistsError, even when the slug also fails', async () => {
    const { repo } = repoWith([
      cancelled('None', 'None', 'ConditionalCheckFailed', 'ConditionalCheckFailed'),
    ]);
    await expect(repo.createProvisioning(tenant)).rejects.toBeInstanceOf(OwnerExistsError);
  });

  it('retries a transaction conflict and then reports the real reason', async () => {
    const { repo, sent } = repoWith([
      cancelled('None', 'None', 'TransactionConflict', 'None'),
      cancelled('None', 'None', 'ConditionalCheckFailed', 'None'),
    ]);
    await expect(repo.createProvisioning(tenant)).rejects.toBeInstanceOf(SlugTakenError);
    expect(sent).toHaveLength(2);
  });

  it('succeeds when a retry goes through', async () => {
    const { repo, sent } = repoWith([cancelled('None', 'None', 'TransactionConflict', 'None')]);
    await repo.createProvisioning(tenant);
    expect(sent).toHaveLength(2);
  });

  it('gives up after repeated conflicts', async () => {
    const conflict = cancelled('TransactionConflict', 'None', 'None', 'None');
    const { repo } = repoWith(Array.from({ length: 10 }, () => conflict));
    await expect(repo.createProvisioning(tenant)).rejects.toBeInstanceOf(TransactionConflictError);
  });

  it('rethrows errors that are not cancellations', async () => {
    const boom = new Error('boom');
    const { repo } = repoWith([boom]);
    await expect(repo.createProvisioning(tenant)).rejects.toBe(boom);
  });
});

describe('updateProvisioning', () => {
  it('swaps the slug in one transaction: profile update, new slug put, old slug delete', async () => {
    const { repo, sent } = repoWith([]);
    await repo.updateProvisioning(tenant, {
      name: 'New',
      slug: 'new-slug',
      timeZone: 'Europe/Berlin',
    });

    const items = (sent[0] as TransactWriteCommand).input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    expect(items[0]?.Update?.ConditionExpression).toBe('#status = :provisioning');
    expect(items[1]?.Put?.Item?.['PK']).toBe('SLUG#new-slug');
    expect(items[1]?.Put?.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(items[2]?.Delete?.Key).toEqual({ PK: 'SLUG#ahmet-berber', SK: 'SLUG' });
  });

  it('does not touch slug items when the slug is unchanged', async () => {
    const { repo, sent } = repoWith([]);
    await repo.updateProvisioning(tenant, {
      name: 'New',
      slug: tenant.slug,
      timeZone: tenant.timeZone,
    });
    expect((sent[0] as TransactWriteCommand).input.TransactItems).toHaveLength(1);
  });

  it('maps a taken new slug and a non-provisioning tenant', async () => {
    const changes = { name: 'N', slug: 'new-slug', timeZone: 'Europe/Berlin' };
    const taken = repoWith([cancelled('None', 'ConditionalCheckFailed', 'None')]);
    await expect(taken.repo.updateProvisioning(tenant, changes)).rejects.toBeInstanceOf(
      SlugTakenError,
    );
    const active = repoWith([cancelled('ConditionalCheckFailed', 'None', 'None')]);
    await expect(active.repo.updateProvisioning(tenant, changes)).rejects.toBeInstanceOf(
      NotProvisioningError,
    );
  });
});
