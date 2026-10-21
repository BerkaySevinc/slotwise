import { z } from 'zod';
import type { ErrorDetail } from './errors.js';

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'login',
  'logout',
  'signup',
  'register',
  'www',
  'public',
  'static',
  'assets',
  'docs',
  'help',
  'support',
  'status',
  'billing',
  'dashboard',
  'settings',
]);

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Returns the canonical IANA name, or undefined when the runtime does not know the zone. */
export function canonicalTimeZone(value: string): string | undefined {
  // Area/Location form only: this also rejects UTC offsets such as "+03:00", which Intl accepts.
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(value)) return undefined;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export const createTenantRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .min(3)
    .max(30)
    .regex(SLUG_PATTERN)
    .refine((slug) => !RESERVED_SLUGS.has(slug), { error: 'reserved' }),
  timeZone: z
    .string()
    .refine((tz) => canonicalTimeZone(tz) !== undefined, { error: 'invalid_time_zone' })
    .transform((tz) => canonicalTimeZone(tz) ?? tz),
});

export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; details: ErrorDetail[] };

function issueCode(issue: z.core.$ZodIssue, body: unknown): string {
  switch (issue.code) {
    case 'custom':
      return issue.message;
    case 'invalid_type':
      return valueAt(body, issue.path) === undefined ? 'required' : 'invalid_type';
    case 'too_small':
      return 'too_short';
    case 'too_big':
      return 'too_long';
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

/** Validates an already JSON-parsed body. Anything that is not an object (null, array, ...) fails. */
export function parseCreateTenantRequest(body: unknown): ParseResult<CreateTenantRequest> {
  const result = createTenantRequestSchema.safeParse(body);
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
