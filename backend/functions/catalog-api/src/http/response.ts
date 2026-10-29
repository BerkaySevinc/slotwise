import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ApiError, type ParseResult } from '@slotwise/shared';

export const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const errorResponse = (e: ApiError): APIGatewayProxyStructuredResultV2 =>
  json(e.statusCode, {
    code: e.code,
    message: e.message,
    ...(e.details === undefined ? {} : { details: e.details }),
  });

export const invalid = (field: string, issue: string): ApiError =>
  new ApiError(400, 'validation_failed', 'The request is not valid.', [{ field, issue }]);

/** Unwraps a parse result, or throws the 400 for it. */
export const valid = <T>(result: ParseResult<T>): T => {
  if (!result.ok) {
    throw new ApiError(400, 'validation_failed', 'The request is not valid.', result.details);
  }
  return result.value;
};

export function readJson(event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown {
  if (event.body === undefined || event.body === '') throw invalid('body', 'required');
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw invalid('body', 'malformed');
  }
}

/** What a feature's route handler needs from the HTTP event. */
export interface RouteRequest {
  body: () => unknown;
  query: Record<string, string | undefined> | undefined;
  /** The `{serviceId}` or `{staffId}` of the path, empty when the route has none. */
  id: string;
}
