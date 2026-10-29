import { describe, expect, it } from 'vitest';
import { parseListQuery } from './list-query.js';

const issues = (result: { ok: boolean; details?: { field: string; issue: string }[] }) =>
  result.ok ? [] : (result.details ?? []).map((d) => `${d.field}:${d.issue}`);

describe('list query', () => {
  it('defaults to 50 active services', () => {
    expect(parseListQuery(undefined)).toEqual({
      ok: true,
      value: { includeInactive: false, limit: 50 },
    });
  });

  it('reads the parameters and ignores unknown ones', () => {
    expect(
      parseListQuery({
        includeInactive: 'true',
        limit: '100',
        nextToken: 'abc',
        other: 'x',
      }),
    ).toEqual({ ok: true, value: { includeInactive: true, limit: 100, nextToken: 'abc' } });
  });

  it.each([
    [{ limit: '0' }, 'limit:too_small'],
    [{ limit: '101' }, 'limit:too_large'],
    [{ limit: 'ten' }, 'limit:invalid_format'],
    [{ limit: '1.5' }, 'limit:invalid_format'],
    [{ includeInactive: 'yes' }, 'includeInactive:invalid'],
  ])('rejects %j', (query, expected) => {
    expect(issues(parseListQuery(query))).toContain(expected);
  });
});
