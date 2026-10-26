import type { z } from 'zod';
import type { ErrorDetail } from './errors.js';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; details: ErrorDetail[] };

function issueCode(issue: z.core.$ZodIssue, body: unknown): string {
  switch (issue.code) {
    case 'custom':
      return issue.message;
    case 'invalid_type':
      return valueAt(body, issue.path) === undefined ? 'required' : 'invalid_type';
    case 'too_small':
      return issue.origin === 'string' ? 'too_short' : 'too_small';
    case 'too_big':
      return issue.origin === 'string' ? 'too_long' : 'too_large';
    case 'not_multiple_of':
      return 'not_a_multiple';
    case 'invalid_format':
      return 'invalid_format';
    default:
      return 'invalid';
  }
}

function valueAt(body: unknown, path: PropertyKey[]): unknown {
  let current = body;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/** Validates an already JSON-parsed value. Anything the schema rejects becomes field-level details. */
export function parseWith<S extends z.ZodType>(schema: S, body: unknown): ParseResult<z.output<S>> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };

  const details: ErrorDetail[] = [];
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) details.push({ field: key, issue: 'unrecognized' });
    } else {
      details.push({ field: issue.path.join('.') || 'body', issue: issueCode(issue, body) });
    }
  }
  return { ok: false, details };
}
