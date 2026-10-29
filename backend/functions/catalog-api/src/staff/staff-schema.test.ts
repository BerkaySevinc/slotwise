import { describe, expect, it } from 'vitest';
import { parseCreateStaffRequest, parseUpdateStaffRequest } from './staff-schema.js';

const issues = (result: { ok: boolean; details?: { field: string; issue: string }[] }) =>
  result.ok ? [] : (result.details ?? []).map((d) => `${d.field}:${d.issue}`);

describe('create staff request', () => {
  it('accepts a name and trims it', () => {
    expect(parseCreateStaffRequest({ name: '  Ahmet ' })).toEqual({
      ok: true,
      value: { name: 'Ahmet' },
    });
  });

  it.each([
    [{ name: '' }, 'name:too_short'],
    [{ name: '   ' }, 'name:too_short'],
    [{ name: 'x'.repeat(81) }, 'name:too_long'],
    [{ name: 5 }, 'name:invalid_type'],
    [{}, 'name:required'],
  ])('rejects %j', (body, expected) => {
    expect(issues(parseCreateStaffRequest(body))).toContain(expected);
  });

  it('accepts 80 characters', () => {
    expect(parseCreateStaffRequest({ name: 'x'.repeat(80) }).ok).toBe(true);
  });

  it.each(['tenantId', 'id', 'active', 'serviceIds', 'email', 'phone', 'createdAt'])(
    'rejects the property %s',
    (key) => {
      expect(issues(parseCreateStaffRequest({ name: 'Ahmet', [key]: 'x' }))).toContain(
        `${key}:unrecognized`,
      );
    },
  );

  it.each([null, undefined, [], 'text', 5])('rejects a body that is not an object: %j', (body) => {
    expect(parseCreateStaffRequest(body).ok).toBe(false);
  });
});

describe('update staff request', () => {
  it.each([
    [{ name: ' New ' }, { name: 'New' }],
    [{ active: false }, { active: false }],
    [
      { name: 'A', active: true },
      { name: 'A', active: true },
    ],
  ])('accepts %j', (body, value) => {
    expect(parseUpdateStaffRequest(body)).toEqual({ ok: true, value });
  });

  it('rejects an empty object', () => {
    expect(issues(parseUpdateStaffRequest({}))).toEqual(['body:empty']);
  });

  it.each([
    [{ active: 'no' }, 'active:invalid_type'],
    [{ name: '' }, 'name:too_short'],
    [{ tenantId: 'x' }, 'tenantId:unrecognized'],
    [{ serviceIds: [] }, 'serviceIds:unrecognized'],
  ])('rejects %j', (body, expected) => {
    expect(issues(parseUpdateStaffRequest(body))).toContain(expected);
  });

  it.each([null, undefined, [], 'text'])('rejects a body that is not an object: %j', (body) => {
    expect(parseUpdateStaffRequest(body).ok).toBe(false);
  });
});
