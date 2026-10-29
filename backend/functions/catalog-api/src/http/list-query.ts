import { z } from 'zod';
import { parseWith, type ParseResult } from '@slotwise/shared';

// Query strings arrive as text. Unknown parameters are ignored.
const listQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).default(50),
  nextToken: z.string().min(1).max(512).optional(),
});

export type ListQuery = z.output<typeof listQuerySchema>;

/** The query of every list endpoint: `limit`, `includeInactive` and `nextToken`. */
export const parseListQuery = (
  query: Record<string, string | undefined> | undefined,
): ParseResult<ListQuery> => parseWith(listQuerySchema, query ?? {});
