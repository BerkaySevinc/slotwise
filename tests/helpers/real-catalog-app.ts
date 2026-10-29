import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { buildHandler } from '../../backend/functions/catalog-api/src/app.js';
import { DynamoServiceRepository } from '../../backend/functions/catalog-api/src/services/dynamo-service-repository.js';
import { DynamoStaffRepository } from '../../backend/functions/catalog-api/src/staff/dynamo-staff-repository.js';

/** The catalog handler wired to a real table, the way `handler.ts` wires it, minus the Lambda. */
export function realCatalogApp(db: DynamoDBDocumentClient, table: string) {
  const logger = { info: () => undefined, error: () => undefined };
  const staffRepository = new DynamoStaffRepository(db, table);
  const common = { newId: ulid, now: () => new Date(), logger };
  return buildHandler({
    services: {
      ...common,
      repository: new DynamoServiceRepository(db, table),
      staff: staffRepository,
    },
    staff: { ...common, repository: staffRepository },
    logger,
  });
}
