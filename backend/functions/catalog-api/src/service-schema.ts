import { z } from 'zod';
import { parseWith, type ParseResult } from '@slotwise/shared';

/** ADR-0002: the locks of one appointment (duration plus buffer on a 5 minute grid) fit one transaction. */
export const MAX_DURATION_PLUS_BUFFER_MINUTES = 480;
export const DURATION_PLUS_BUFFER_ISSUE = 'duration_plus_buffer_too_long';

const name = z.string().trim().min(1).max(80);
const durationMinutes = z.number().int().min(5).max(480).multipleOf(5);
const bufferMinutes = z.number().int().min(0).max(60).multipleOf(5);
const priceMinor = z.number().int().min(0).max(100_000_000);

export const createServiceSchema = z
  .strictObject({
    name,
    durationMinutes,
    bufferMinutes: bufferMinutes.default(0),
    priceMinor,
  })
  .refine((s) => s.durationMinutes + s.bufferMinutes <= MAX_DURATION_PLUS_BUFFER_MINUTES, {
    path: ['bufferMinutes'],
    error: DURATION_PLUS_BUFFER_ISSUE,
  });

export const updateServiceSchema = z
  .strictObject({
    name: name.optional(),
    durationMinutes: durationMinutes.optional(),
    bufferMinutes: bufferMinutes.optional(),
    priceMinor: priceMinor.optional(),
    active: z.boolean().optional(),
  })
  .refine((changes) => Object.values(changes).some((v) => v !== undefined), { error: 'empty' });

export type CreateServiceRequest = z.output<typeof createServiceSchema>;
export type UpdateServiceRequest = z.output<typeof updateServiceSchema>;

// Query strings arrive as text. Unknown parameters are ignored.
const listServicesQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).default(50),
  nextToken: z.string().min(1).max(512).optional(),
});

export type ListServicesQuery = z.output<typeof listServicesQuerySchema>;

export const parseCreateServiceRequest = (body: unknown): ParseResult<CreateServiceRequest> =>
  parseWith(createServiceSchema, body);

export const parseUpdateServiceRequest = (body: unknown): ParseResult<UpdateServiceRequest> =>
  parseWith(updateServiceSchema, body);

export const parseListServicesQuery = (
  query: Record<string, string | undefined> | undefined,
): ParseResult<ListServicesQuery> => parseWith(listServicesQuerySchema, query ?? {});
