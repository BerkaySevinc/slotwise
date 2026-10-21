import type { Context } from 'aws-lambda';
import { IdempotencyConfig, makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ulid } from 'ulid';
import { buildHandler } from './app.js';
import { DynamoTenantRepository } from './dynamo-tenant-repository.js';

// Read at cold start so a missing variable fails the first invocation loudly, not a request later.
function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

const logger = new Logger({ serviceName: 'tenant-api' });
const metrics = new Metrics({ namespace: 'Slotwise', serviceName: 'tenant-api' });
const cognito = new CognitoIdentityProviderClient({});
const userPoolId = env('USER_POOL_ID');

const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: 'scope',
  payloadValidationJmesPath: 'payload',
  throwOnNoIdempotencyKey: true,
  expiresAfterSeconds: 24 * 60 * 60,
});
const persistenceStore = new DynamoDBPersistenceLayer({ tableName: env('IDEMPOTENCY_TABLE') });

const app = buildHandler({
  repository: new DynamoTenantRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env('DATA_TABLE'),
  ),
  directory: {
    async setOwnerClaims(userId, tenantId) {
      // With email as the sign-in name, the user's sub is accepted as Username.
      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: userId,
          UserAttributes: [
            { Name: 'custom:tenant_id', Value: tenantId },
            { Name: 'custom:role', Value: 'owner' },
          ],
        }),
      );
    },
  },
  newId: ulid,
  now: () => new Date(),
  logger: {
    info: (message, extra) => {
      logger.info(message, extra ?? {});
    },
    error: (message, extra) => {
      logger.error(message, extra ?? {});
    },
  },
  onProvisioningIncomplete: () => {
    metrics.addMetric('ProvisioningIncomplete', MetricUnit.Count, 1);
  },
  makeIdempotent: (fn) => makeIdempotent(fn, { persistenceStore, config: idempotencyConfig }),
});

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer, context: Context) => {
  idempotencyConfig.registerLambdaContext(context);
  try {
    return await app(event);
  } finally {
    metrics.publishStoredMetrics();
  }
};
