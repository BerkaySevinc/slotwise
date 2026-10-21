import { describe, expect, it } from 'vitest';
import { parseCreateTenantRequest } from './tenant-schema.js';

const valid = { name: 'Ahmet Berber', slug: 'ahmet-berber', timeZone: 'Europe/Istanbul' };

function issues(body: unknown): string[] {
  const r = parseCreateTenantRequest(body);
  return r.ok ? [] : r.details.map((d) => `${d.field}:${d.issue}`);
}

describe('parseCreateTenantRequest', () => {
  it('accepts a valid body', () => {
    expect(parseCreateTenantRequest(valid)).toEqual({ ok: true, value: valid });
  });

  it.each([null, undefined, 'text', 42, [], [valid]])('rejects a non-object body: %j', (body) => {
    expect(parseCreateTenantRequest(body).ok).toBe(false);
  });

  it('reports missing fields', () => {
    expect(issues({})).toEqual(['name:required', 'slug:required', 'timeZone:required']);
  });

  it.each(['tenantId', 'ownerId', 'role'])('rejects the extra property %s', (key) => {
    expect(issues({ ...valid, [key]: 'x' })).toEqual([`${key}:unrecognized`]);
  });

  describe('name', () => {
    it('is trimmed', () => {
      const r = parseCreateTenantRequest({ ...valid, name: '  Ahmet  ' });
      expect(r.ok && r.value.name).toBe('Ahmet');
    });
    it('rejects empty and whitespace-only names', () => {
      expect(issues({ ...valid, name: '' })).toEqual(['name:too_short']);
      expect(issues({ ...valid, name: '   ' })).toEqual(['name:too_short']);
    });
    it('allows 100 characters but not 101', () => {
      expect(parseCreateTenantRequest({ ...valid, name: 'a'.repeat(100) }).ok).toBe(true);
      expect(issues({ ...valid, name: 'a'.repeat(101) })).toEqual(['name:too_long']);
    });
    it('rejects non-strings', () => {
      expect(issues({ ...valid, name: 5 })).toEqual(['name:invalid_type']);
    });
  });

  describe('slug', () => {
    it.each(['abc', 'a-b', 'barber-2', 'a'.repeat(30), '123'])('accepts %s', (slug) => {
      expect(parseCreateTenantRequest({ ...valid, slug }).ok).toBe(true);
    });
    it.each(['ab', '-abc', 'abc-', 'a--b', 'ABC', 'a_b', 'a b', 'çay', 'a.b'])(
      'rejects %s',
      (slug) => {
        expect(parseCreateTenantRequest({ ...valid, slug }).ok).toBe(false);
      },
    );
    it('rejects 31 characters', () => {
      expect(issues({ ...valid, slug: 'a'.repeat(31) })).toEqual(['slug:too_long']);
    });
    it.each(['admin', 'api', 'www', 'dashboard', 'settings'])(
      'rejects reserved word %s',
      (slug) => {
        expect(issues({ ...valid, slug })).toEqual(['slug:reserved']);
      },
    );
  });

  describe('timeZone', () => {
    it.each(['Europe/Istanbul', 'Europe/Berlin', 'America/Argentina/Buenos_Aires'])(
      'accepts %s',
      (timeZone) => {
        expect(parseCreateTenantRequest({ ...valid, timeZone }).ok).toBe(true);
      },
    );
    it.each(['Mars/Base', '+03:00', 'Istanbul', '', 'EST', 'Europe/'])('rejects %s', (timeZone) => {
      expect(issues({ ...valid, timeZone })).toEqual(['timeZone:invalid_time_zone']);
    });
    it('stores the canonical name', () => {
      const r = parseCreateTenantRequest({ ...valid, timeZone: 'europe/istanbul' });
      expect(r.ok && r.value.timeZone).toBe('Europe/Istanbul');
    });
  });
});
