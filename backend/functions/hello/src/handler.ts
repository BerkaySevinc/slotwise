import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// Throwaway smoke test for the deploy chain. It is not part of the product API and is removed
// once real endpoints exist.
export const handler = (): Promise<APIGatewayProxyStructuredResultV2> =>
  Promise.resolve({
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hello from slotwise' }),
  });
