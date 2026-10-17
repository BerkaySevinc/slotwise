import { describe, expect, it } from 'vitest';
import { handler } from './handler.js';

describe('hello handler', () => {
  it('returns 200 with a JSON greeting', async () => {
    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(result.body ?? '')).toEqual({ message: 'hello from slotwise' });
  });
});
