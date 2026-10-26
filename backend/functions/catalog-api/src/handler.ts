import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { buildHandler } from './app.js';
import { DynamoServiceRepository } from './dynamo-service-repository.js';

// Read at cold start so a missing variable fails the first invocation loudly, not a request later.
function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

const logger = new Logger({ serviceName: 'catalog-api' });

export const handler = buildHandler({
  repository: new DynamoServiceRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env('DATA_TABLE'),
  ),
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
});
