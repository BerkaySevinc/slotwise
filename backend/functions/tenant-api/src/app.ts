import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  IdempotencyAlreadyInProgressError,
  IdempotencyValidationError,
} from '@aws-lambda-powertools/idempotency';
import { ApiError, getCaller, parseCreateTenantRequest } from '@slotwise/shared';
import type { CreateTenantRequest } from '@slotwise/shared';
import { createTenant, type CreateTenantDeps, type Logger } from './create-tenant.js';

/** What the idempotent function receives; Powertools derives the key and the payload hash from it. */
export interface IdempotentCall {
  /** User id plus Idempotency-Key, so one user's key never collides with another's. */
  scope: string;
  /** The validated request in canonical form, so formatting differences do not count as a change. */
  payload: string;
  userId: string;
  input: CreateTenantRequest;
}

type Idempotent = (
  fn: (call: IdempotentCall) => Promise<APIGatewayProxyStructuredResultV2>,
) => (call: IdempotentCall) => Promise<APIGatewayProxyStructuredResultV2>;

export interface AppDeps extends CreateTenantDeps {
  logger: Logger;
  /** Wraps a function with Powertools idempotency in production; identity in unit tests. */
  makeIdempotent: Idempotent;
}

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const errorResponse = (e: ApiError): APIGatewayProxyStructuredResultV2 =>
  json(e.statusCode, {
    code: e.code,
    message: e.message,
    ...(e.details === undefined ? {} : { details: e.details }),
  });

const invalid = (field: string, issue: string): ApiError =>
  new ApiError(400, 'validation_failed', 'The request is not valid.', [{ field, issue }]);

function readIdempotencyKey(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const key = event.headers['idempotency-key'];
  if (key === undefined || key === '') throw invalid('Idempotency-Key', 'required');
  if (key.length < 8 || key.length > 128) throw invalid('Idempotency-Key', 'invalid_length');
  return key;
}

function readBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): CreateTenantRequest {
  if (event.body === undefined || event.body === '') throw invalid('body', 'required');
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid('body', 'malformed');
  }
  const result = parseCreateTenantRequest(parsed);
  if (!result.ok) {
    throw new ApiError(400, 'validation_failed', 'The request is not valid.', result.details);
  }
  return result.value;
}

export function buildHandler(deps: AppDeps) {
  const create = deps.makeIdempotent(async (call) => {
    const tenant = await createTenant(deps, call.userId, call.input);
    return json(201, {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      timeZone: tenant.timeZone,
      status: tenant.status,
      createdAt: tenant.createdAt,
    });
  });

  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      // POST /tenants is the one endpoint that accepts a token without a tenant (ADR-0007).
      const caller = getCaller(event);
      const key = readIdempotencyKey(event);
      const input = readBody(event);
      return await create({
        scope: `${caller.userId}:${key}`,
        payload: JSON.stringify(input),
        userId: caller.userId,
        input,
      });
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e);
      if (e instanceof IdempotencyValidationError) {
        return errorResponse(
          new ApiError(
            422,
            'idempotency_key_mismatch',
            'This Idempotency-Key was used with a different request.',
          ),
        );
      }
      if (e instanceof IdempotencyAlreadyInProgressError) {
        return errorResponse(
          new ApiError(409, 'request_in_progress', 'The same request is still being processed.'),
        );
      }
      deps.logger.error('unhandled error', {
        errorName: e instanceof Error ? e.name : 'unknown',
      });
      return errorResponse(new ApiError(500, 'internal_error', 'Something went wrong.'));
    }
  };
}
