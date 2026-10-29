import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { buildHandler } from './app.js';
import { DynamoServiceRepository } from './services/dynamo-service-repository.js';
import { DynamoStaffRepository } from './staff/dynamo-staff-repository.js';

// Read at cold start so a missing variable fails the first invocation loudly, not a request later.
function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

const powertools = new Logger({ serviceName: 'catalog-api' });
const logger = {
  info: (message: string, extra?: Record<string, unknown>) => {
    powertools.info(message, extra ?? {});
  },
  error: (message: string, extra?: Record<string, unknown>) => {
    powertools.error(message, extra ?? {});
  },
};

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = env('DATA_TABLE');
const staffRepository = new DynamoStaffRepository(db, table);
const common = { newId: ulid, now: () => new Date(), logger };

export const handler = buildHandler({
  services: {
    ...common,
    repository: new DynamoServiceRepository(db, table),
    staff: staffRepository,
  },
  staff: { ...common, repository: staffRepository },
  logger,
});
