import { describe, expect, it } from 'vitest';
import { ownerKey, serviceKey, slugKey, tenantProfileKey, tenantSettingsKey } from './keys.js';

describe('key builders', () => {
  it('builds tenant keys from the tenant id', () => {
    expect(tenantProfileKey('01ABC')).toEqual({ PK: 'T#01ABC', SK: 'PROFILE' });
    expect(tenantSettingsKey('01ABC')).toEqual({ PK: 'T#01ABC', SK: 'SETTINGS' });
  });
  it('builds the slug and owner lookup keys', () => {
    expect(slugKey('ahmet')).toEqual({ PK: 'SLUG#ahmet', SK: 'SLUG' });
    expect(ownerKey('sub-1')).toEqual({ PK: 'OWNER#sub-1', SK: 'OWNER' });
  });
  it('puts a service under its tenant', () => {
    expect(serviceKey('01ABC', '01SVC')).toEqual({ PK: 'T#01ABC', SK: 'SVC#01SVC' });
  });
});
