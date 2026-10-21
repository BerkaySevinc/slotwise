// The only place that builds DynamoDB keys (ADR-0002). Item meaning lives here, not in the table.

export interface ItemKey {
  PK: string;
  SK: string;
}

export const tenantProfileKey = (tenantId: string): ItemKey => ({
  PK: `T#${tenantId}`,
  SK: 'PROFILE',
});

export const tenantSettingsKey = (tenantId: string): ItemKey => ({
  PK: `T#${tenantId}`,
  SK: 'SETTINGS',
});

export const slugKey = (slug: string): ItemKey => ({ PK: `SLUG#${slug}`, SK: 'SLUG' });

/** Maps a Cognito user id (`sub`) to its tenant. Like the slug item, it does not start with a tenant id. */
export const ownerKey = (userId: string): ItemKey => ({ PK: `OWNER#${userId}`, SK: 'OWNER' });
