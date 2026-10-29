import { describe, expect, it } from 'vitest';
import { parseCreateServiceRequest, parseUpdateServiceRequest } from './service-schema.js';

const good = { name: 'Haircut', durationMinutes: 30, priceMinor: 25050 };

const issues = (result: { ok: boolean; details?: { field: string; issue: string }[] }) =>
  result.ok ? [] : (result.details ?? []).map((d) => `${d.field}:${d.issue}`);

describe('create service request', () => {
  it('accepts a minimal body and defaults the buffer to 0 and the staff to none', () => {
    expect(parseCreateServiceRequest(good)).toEqual({
      ok: true,
      value: { ...good, bufferMinutes: 0, staffIds: [] },
    });
  });

  it('trims the name and accepts a free service', () => {
    const r = parseCreateServiceRequest({ ...good, name: '  Beard  ', priceMinor: 0 });
    expect(r).toMatchObject({ ok: true, value: { name: 'Beard', priceMinor: 0 } });
  });

  it.each([
    [{ ...good, name: '' }, 'name:too_short'],
    [{ ...good, name: '   ' }, 'name:too_short'],
    [{ ...good, name: 'x'.repeat(81) }, 'name:too_long'],
    [{ ...good, name: 5 }, 'name:invalid_type'],
    [{ ...good, durationMinutes: 0 }, 'durationMinutes:too_small'],
    [{ ...good, durationMinutes: 481 }, 'durationMinutes:too_large'],
    [{ ...good, durationMinutes: 32 }, 'durationMinutes:not_a_multiple'],
    [{ ...good, durationMinutes: 7.5 }, 'durationMinutes:invalid_type'],
    [{ ...good, bufferMinutes: -5 }, 'bufferMinutes:too_small'],
    [{ ...good, bufferMinutes: 65 }, 'bufferMinutes:too_large'],
    [{ ...good, bufferMinutes: 3 }, 'bufferMinutes:not_a_multiple'],
    [{ ...good, priceMinor: -1 }, 'priceMinor:too_small'],
    [{ ...good, priceMinor: 100_000_001 }, 'priceMinor:too_large'],
    [{ ...good, priceMinor: 250.5 }, 'priceMinor:invalid_type'],
    [{ ...good, priceMinor: '250' }, 'priceMinor:invalid_type'],
    [{ durationMinutes: 30, priceMinor: 1 }, 'name:required'],
    [{ name: 'x', priceMinor: 1 }, 'durationMinutes:required'],
    [{ name: 'x', durationMinutes: 30 }, 'priceMinor:required'],
  ])('rejects %j', (body, expected) => {
    expect(issues(parseCreateServiceRequest(body))).toContain(expected);
  });

  it('rejects a duration and buffer that together exceed 480 minutes', () => {
    expect(
      issues(parseCreateServiceRequest({ ...good, durationMinutes: 450, bufferMinutes: 35 })),
    ).toEqual(['bufferMinutes:duration_plus_buffer_too_long']);
    expect(parseCreateServiceRequest({ ...good, durationMinutes: 420, bufferMinutes: 60 }).ok).toBe(
      true,
    );
  });

  it.each([null, undefined, [], 'text', 5])('rejects a body that is not an object: %j', (body) => {
    expect(parseCreateServiceRequest(body).ok).toBe(false);
  });

  it.each(['tenantId', 'id', 'active', 'currency', 'createdAt'])(
    'rejects the property %s',
    (key) => {
      expect(issues(parseCreateServiceRequest({ ...good, [key]: 'x' }))).toContain(
        `${key}:unrecognized`,
      );
    },
  );
});

describe('update service request', () => {
  it.each([
    [{ name: ' New ' }, { name: 'New' }],
    [{ active: false }, { active: false }],
    [
      { priceMinor: 0, bufferMinutes: 10 },
      { priceMinor: 0, bufferMinutes: 10 },
    ],
  ])('accepts %j', (body, value) => {
    expect(parseUpdateServiceRequest(body)).toEqual({ ok: true, value });
  });

  it('rejects an empty object', () => {
    expect(issues(parseUpdateServiceRequest({}))).toEqual(['body:empty']);
  });

  it.each([
    [{ active: 'no' }, 'active:invalid_type'],
    [{ durationMinutes: 33 }, 'durationMinutes:not_a_multiple'],
    [{ tenantId: 'x' }, 'tenantId:unrecognized'],
    [{ id: 'x' }, 'id:unrecognized'],
  ])('rejects %j', (body, expected) => {
    expect(issues(parseUpdateServiceRequest(body))).toContain(expected);
  });

  it.each([null, undefined, [], 'text'])('rejects a body that is not an object: %j', (body) => {
    expect(parseUpdateServiceRequest(body).ok).toBe(false);
  });
});

describe('staffIds', () => {
  it('accepts up to 50 distinct ids on create and update', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `staff-${String(i)}`);
    expect(parseCreateServiceRequest({ ...good, staffIds: ids }).ok).toBe(true);
    expect(parseUpdateServiceRequest({ staffIds: ids }).ok).toBe(true);
  });

  it('accepts an empty array to empty the set', () => {
    expect(parseUpdateServiceRequest({ staffIds: [] })).toEqual({
      ok: true,
      value: { staffIds: [] },
    });
  });

  it.each([
    [{ staffIds: Array.from({ length: 51 }, (_, i) => `s${String(i)}`) }, 'staffIds:too_large'],
    [{ staffIds: ['a', 'a'] }, 'staffIds:duplicate_ids'],
    [{ staffIds: 'a' }, 'staffIds:invalid_type'],
    [{ staffIds: [5] }, 'staffIds.0:invalid_type'],
    [{ staffIds: [''] }, 'staffIds.0:too_short'],
  ])('rejects %j', (extra, expected) => {
    expect(issues(parseCreateServiceRequest({ ...good, ...extra }))).toContain(expected);
    expect(issues(parseUpdateServiceRequest(extra))).toContain(expected);
  });
});
