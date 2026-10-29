import { describe, expect, it } from 'vitest';
import { TENANT_A, apiEvent, ownerOf } from '../../../../tests/helpers/api-event.js';
import { buildHandler } from './app.js';
import { makeCatalog } from './testing.js';

// AC-03.19: logs contain ids and error codes, never the service name or the request body.
// This checks everything the application passes to its logger; the Powertools logger itself does
// not log the event unless configured to, which is verified after deploy.
const NAME = 'Zeynep Secret Haircut';

describe('logging', () => {
  it('never logs the service name, on success, on update or on a failure', async () => {
    const lines: string[] = [];
    const record = (message: string, extra?: Record<string, unknown>) =>
      lines.push(JSON.stringify({ message, ...extra }));
    const deps = makeCatalog({ logger: { info: record, error: record } });
    const app = buildHandler(deps.app);
    const body = { name: NAME, durationMinutes: 30, priceMinor: 100 };

    const created = await app(
      apiEvent({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body }),
    );
    const id = (JSON.parse(created.body ?? '{}') as { id: string }).id;
    await app(
      apiEvent({
        routeKey: 'PATCH /services/{serviceId}',
        caller: ownerOf(TENANT_A),
        pathParameters: { serviceId: id },
        body: { name: `${NAME} 2` },
      }),
    );
    deps.serviceRepository.create = () => Promise.reject(new Error(`failed for ${NAME}`));
    await app(apiEvent({ routeKey: 'POST /services', caller: ownerOf(TENANT_A), body }));

    const logged = lines.join('\n');
    expect(logged).toContain('service created');
    expect(logged).not.toContain('Zeynep');
    expect(logged).not.toContain('Secret');
  });
});
