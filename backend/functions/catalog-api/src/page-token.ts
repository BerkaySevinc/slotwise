import { ApiError } from '@slotwise/shared';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const invalid = (): ApiError =>
  new ApiError(400, 'invalid_page_token', 'The page token is not valid.');

/**
 * The token only says where the previous page ended. The tenant is stored in it so that a token
 * from another tenant is refused, but the query never takes its tenant from the token.
 */
export function encodePageToken(tenantId: string, lastServiceId: string): string {
  return Buffer.from(JSON.stringify({ t: tenantId, id: lastServiceId })).toString('base64url');
}

/** Returns the id of the last service of the previous page. */
export function decodePageToken(token: string, tenantId: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== 'object' || parsed === null) throw invalid();
  const { t, id } = parsed as Record<string, unknown>;
  if (t !== tenantId || typeof id !== 'string' || !ULID_PATTERN.test(id)) throw invalid();
  return id;
}
