import { describe, expect, it } from 'vitest';
import { decodePageToken, encodePageToken } from './page-token.js';

const TENANT_A = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const TENANT_B = '01JBBBBBBBBBBBBBBBBBBBBBBB';
const SERVICE = '01JSVCSVCSVCSVCSVCSVCSVCSV';

const bad = (token: string, tenant = TENANT_A) => {
  try {
    decodePageToken(token, tenant);
    expect.unreachable();
  } catch (e) {
    expect(e).toMatchObject({ statusCode: 400, code: 'invalid_page_token' });
  }
};

describe('page token', () => {
  it('round-trips the last service id for the same tenant', () => {
    expect(decodePageToken(encodePageToken(TENANT_A, SERVICE), TENANT_A)).toBe(SERVICE);
  });

  it('refuses a token issued for another tenant (AC-03.9)', () => {
    bad(encodePageToken(TENANT_B, SERVICE));
  });

  it.each([
    ['not base64 json', '%%%'],
    ['json that is not an object', Buffer.from('"x"').toString('base64url')],
    ['null', Buffer.from('null').toString('base64url')],
    ['no id', Buffer.from(JSON.stringify({ t: TENANT_A })).toString('base64url')],
    [
      'an id that is not a ULID',
      Buffer.from(JSON.stringify({ t: TENANT_A, id: 'x#y' })).toString('base64url'),
    ],
  ])('refuses %s', (_name, token) => {
    bad(token);
  });
});
